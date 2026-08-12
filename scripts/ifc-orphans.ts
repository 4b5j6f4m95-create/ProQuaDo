/**
 * Findet IFC-Uploads im Objektspeicher, auf die keine Zeile in
 * `ifc_imports` mehr zeigt.
 *
 *   pnpm run ifc:orphans              # nur berichten, nichts anfassen
 *   pnpm run ifc:orphans -- --delete  # nach dem Bericht auch löschen
 *
 * **Berichten ist die Vorgabe, Löschen die Ausnahme.** Ein Werkzeug, das
 * beim ersten Aufruf löscht, wird irgendwann versehentlich aufgerufen.
 *
 * ── Warum es das gibt ────────────────────────────────────────
 *
 * Die Route legt eine hochgeladene Datei ab, bevor sie prüfen kann, ob der
 * Import zulässig ist — der Virenscanner arbeitet auf dem Objektspeicher und
 * nicht auf einem Puffer. Seit `import-ifc/route.ts` bei jedem Fehlschlag
 * aufräumt, entstehen keine neuen Waisen mehr. Die aus der Zeit davor liegen
 * weiterhin dort, und ein gelöschter Plan hinterlässt bis heute eine (die
 * Zeile geht, das Objekt bleibt).
 *
 * ── Drei Sicherungen, und die erste ist die wichtigste ──────
 *
 * 1. **Die Verbindung muss die schemabesitzende sein.** `proquado_app`
 *    unterliegt RLS und sieht ohne gesetzten Organisationskontext **null**
 *    Zeilen (docs/13 Schritt 6 misst das nach). Mit dieser Rolle hielte der
 *    Lauf jedes Objekt für verwaist und würde beim Löschen den gesamten
 *    Bestand vernichten. Deshalb `DIRECT_DATABASE_URL`, und deshalb die
 *    Plausibilitätsprüfung darunter.
 *
 * 2. **Nichts löschen, was gerade hochgeladen wird.** Zwischen `putObject`
 *    und dem `INSERT` in `ifc_imports` liegen bei 23 MB einige Sekunden. Ein
 *    Lauf, der in dieses Fenster fällt, würde eine Datei entfernen, deren
 *    Import gerade läuft. Objekte, die jünger sind als `--min-age-hours`
 *    (Vorgabe 24), bleiben deshalb unangetastet und werden getrennt
 *    ausgewiesen.
 *
 * 3. **Wenn die Datenbank gar nichts kennt, wird nicht gelöscht.** Null
 *    bekannte Schlüssel bei vorhandenen Objekten ist genau die Signatur von
 *    Sicherung 1, die versagt hat — leere Tabelle und falsche Rolle sehen von
 *    hier aus gleich aus. Der Lauf bricht dann ab, statt zu raten.
 *
 * ── Zwei Arten von Waisen, und nur eine wird gelöscht ───────
 *
 * **Ohne Spur im Audit-Trail**: ein Versuch, der abgewiesen wurde. Er hat nie
 * einen Plan erzeugt, nichts ist ihm zugerechnet, die Datei ist Abfall.
 *
 * **Mit Eintrag `ifc_import.executed`**: ein Import, der stattgefunden hat
 * und dessen Plan später verschwand. Nach ADR-004 bleibt der Vorgang
 * zugerechnet — seine Datei wegzuwerfen macht aus einem nachlesbaren Vorgang
 * einen unbelegbaren. Solche Funde werden **nie** automatisch gelöscht,
 * sondern getrennt ausgewiesen und einem Menschen vorgelegt.
 *
 * Möglich ist diese Unterscheidung erst, seit der Audit-Eintrag den
 * Speicherschlüssel mitführt. **Für Importe davor bleibt sie unmöglich** —
 * Dateiname und Hash sagen nichts darüber, wo die Datei liegt. Ältere Funde
 * erscheinen deshalb als „ohne Spur", obwohl sie es womöglich nicht sind;
 * wer eine Umgebung mit Importhistorie aufräumt, sollte das wissen.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { listObjects, deleteObjects } from '@/lib/storage/object-storage';

const PREFIX = 'ifc/';

interface Options {
  deleteFound: boolean;
  minAgeHours: number;
}

function parseOptions(argv: readonly string[]): Options {
  const deleteFound = argv.includes('--delete');
  const ageArg = argv.find((a) => a.startsWith('--min-age-hours='));
  const minAgeHours = ageArg ? Number(ageArg.split('=')[1]) : 24;
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
    throw new Error('--min-age-hours erwartet eine Zahl ≥ 0.');
  }
  return { deleteFound, minAgeHours };
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DIRECT_DATABASE_URL ist nicht gesetzt. Dieser Lauf braucht die schemabesitzende ' +
        'Verbindung — mit der Anwendungsrolle greift RLS, und dann sähe er null bekannte ' +
        'Schlüssel und hielte jedes Objekt für verwaist.',
    );
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const [objects, rows, auditRows] = await Promise.all([
      listObjects(PREFIX),
      db.ifcImport.findMany({ select: { storageKey: true } }),
      // Schlüssel aus dem Audit-Trail. `new_values->>'storageKey'` gibt es
      // erst seit dem Import, der ihn mitschreibt — ältere Einträge liefern
      // NULL und fallen hier heraus.
      db.$queryRaw<Array<{ storage_key: string }>>`
        SELECT DISTINCT new_values ->> 'storageKey' AS storage_key
          FROM audit_events
         WHERE event_type = 'ifc_import.executed'
           AND new_values ->> 'storageKey' IS NOT NULL`,
    ]);

    const known = new Set(rows.map((r) => r.storageKey));
    const recorded = new Set(auditRows.map((r) => r.storage_key));
    const orphans = objects.filter((o) => !known.has(o.storageKey));
    const auditProtected = orphans.filter((o) => recorded.has(o.storageKey));

    const cutoff = Date.now() - options.minAgeHours * 3600_000;
    const deletable = orphans.filter((o) => !recorded.has(o.storageKey));
    const oldEnough = deletable.filter((o) => o.lastModified.getTime() < cutoff);
    const tooYoung = deletable.filter((o) => o.lastModified.getTime() >= cutoff);

    const totalBytes = objects.reduce((sum, o) => sum + o.sizeBytes, 0);
    const orphanBytes = oldEnough.reduce((sum, o) => sum + o.sizeBytes, 0);

    console.log(`Objekte unter „${PREFIX}“: ${objects.length} (${formatMb(totalBytes)})`);
    console.log(`Zeilen in ifc_imports:    ${known.size}`);
    console.log(`Ohne Zeile:               ${orphans.length}`);
    console.log(
      `  davon älter als ${options.minAgeHours} h: ${oldEnough.length} (${formatMb(orphanBytes)})`,
    );
    if (tooYoung.length > 0) {
      console.log(
        `  davon jünger — unangetastet: ${tooYoung.length} ` +
          '(könnten Uploads sein, deren Import gerade läuft)',
      );
    }
    if (auditProtected.length > 0) {
      console.log(
        `  im Audit-Trail verzeichnet:  ${auditProtected.length} ` +
          '(wird nie automatisch gelöscht)',
      );
    }

    if (orphans.length === 0) {
      console.log('\nNichts zu tun.');
      return;
    }

    // Auch die zu jungen werden aufgeführt, nur als geschützt gekennzeichnet.
    // Wer den Bestand beurteilen will, will ihn ganz sehen — eine Liste, die
    // schweigt, wo sie nichts löschen darf, verschweigt die Hälfte.
    console.log('\nGefunden:');
    const young = new Set(tooYoung.map((o) => o.storageKey));
    for (const orphan of [...orphans].sort(
      (a, b) => a.lastModified.getTime() - b.lastModified.getTime(),
    )) {
      const ageHours = (Date.now() - orphan.lastModified.getTime()) / 3600_000;
      const age = ageHours < 48 ? `${ageHours.toFixed(0)} h` : `${Math.floor(ageHours / 24)} Tage`;
      const mark = recorded.has(orphan.storageKey)
        ? '  [im Audit-Trail verzeichnet — von Hand entscheiden]'
        : young.has(orphan.storageKey)
          ? '  [geschützt, zu jung]'
          : '';
      console.log(
        `  ${orphan.storageKey}  ${formatMb(orphan.sizeBytes).padStart(9)}  ${age.padStart(7)} alt${mark}`,
      );
    }

    if (!options.deleteFound) {
      console.log(
        '\nNur berichtet, nichts gelöscht. Zum Löschen: pnpm run ifc:orphans -- --delete',
      );
      console.log(
        'Funde mit Audit-Eintrag bleiben auch dann liegen: nach ADR-004 ist der Vorgang\n' +
          'zugerechnet, und seine Datei wegzuwerfen macht ihn unbelegbar. Diese Entscheidung\n' +
          'gehört einem Menschen.\n' +
          'Achtung bei Umgebungen mit älterer Importhistorie: der Speicherschlüssel steht erst\n' +
          'seit Kurzem im Audit-Eintrag. Ältere Funde erscheinen als „ohne Spur", obwohl sie es\n' +
          'womöglich nicht sind.',
      );
      return;
    }

    // Sicherung 3.
    if (known.size === 0 && objects.length > 0) {
      throw new Error(
        `Die Datenbank kennt keinen einzigen Schlüssel, im Speicher liegen aber ${objects.length} ` +
          'Objekte. Das ist entweder eine wirklich leere Tabelle oder eine Verbindung, der RLS ' +
          'die Zeilen verbirgt — von hier aus nicht zu unterscheiden. Es wird nichts gelöscht.',
      );
    }

    if (oldEnough.length === 0) {
      console.log('\nNichts alt genug zum Löschen.');
      return;
    }

    // In Stapeln, weil DeleteObjects höchstens 1000 Schlüssel je Aufruf nimmt.
    for (let i = 0; i < oldEnough.length; i += 500) {
      await deleteObjects(oldEnough.slice(i, i + 500).map((o) => o.storageKey));
    }
    console.log(`\n${oldEnough.length} Objekte gelöscht (${formatMb(orphanBytes)}).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
