import type { PrismaClient } from '@prisma/client';
import { listObjects, type Environment } from './environment';

/**
 * Die Prüfungen aus docs/09 Ebene 10, Punkt 2: referenzielle Integrität
 * zwischen Audit, Dateien und Datenbank.
 *
 * Jede Prüfung nennt bei Verstoß **die betroffenen Zeilen**, nicht nur eine
 * Zahl. Ein Restore-Bericht, der „3 Abweichungen" meldet, verschiebt die
 * eigentliche Arbeit nur auf den Tag des Ausfalls.
 */

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

/** Zeilenzahlen der Tabellen, an denen ein unvollständiger Restore zuerst
 *  auffällt. */
const COUNTED_TABLES = [
  'organizations',
  'users',
  'projects',
  'documents',
  'document_revisions',
  'production_plan_revisions',
  'plan_steps',
  'production_orders',
  'work_step_instances',
  'checklist_responses',
  'measurement_results',
  'photo_evidence',
  'step_confirmations',
  'completion_submissions',
  'product_releases',
  'audit_events',
  'outbox_events',
] as const;

export async function countRows(db: PrismaClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM ${table}`,
    );
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

export function compareCounts(
  source: Record<string, number>,
  restored: Record<string, number>,
): CheckResult {
  const differences = Object.keys(source)
    .filter((table) => source[table] !== restored[table])
    .map((table) => `${table}: Quelle ${source[table]}, Ziel ${restored[table]}`);

  return {
    name: 'Zeilenzahlen stimmen überein',
    passed: differences.length === 0,
    detail:
      differences.length === 0
        ? `${Object.keys(source).length} Tabellen, ${Object.values(source).reduce((a, b) => a + b, 0)} Zeilen`
        : differences.join('; '),
  };
}

/**
 * Jede Datei, auf die die Datenbank zeigt, muss im Objektspeicher liegen.
 * Diese Richtung ist die wichtige: eine fehlende Datei macht aus einem
 * Nachweis eine Behauptung.
 */
export async function checkReferencedFilesExist(target: Environment): Promise<CheckResult> {
  const keys = new Set(await listObjects(target));

  const photos = await target.owner.photoEvidence.findMany({
    where: { uploadStatus: 'COMPLETED' },
    select: { id: true, storageKey: true },
  });
  const revisions = await target.owner.documentRevision.findMany({
    where: { storageKey: { not: null } },
    select: { id: true, storageKey: true },
  });

  const missing = [
    ...photos.filter((p) => !keys.has(p.storageKey)).map((p) => `photo_evidence ${p.id}`),
    ...revisions
      .filter((r) => r.storageKey && !keys.has(r.storageKey))
      .map((r) => `document_revision ${r.id}`),
  ];

  return {
    name: 'Referenzierte Dateien liegen im Objektspeicher',
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? `${photos.length} Fotos, ${revisions.length} Dokumentdateien`
        : `fehlend: ${missing.join(', ')}`,
  };
}

/**
 * Die Gegenrichtung: Objekte ohne Datenbankzeile. Das ist **kein** Fehler —
 * ein abgebrochener Upload hinterlässt genau das —, aber es gehört gezählt.
 * Wächst die Zahl über die Zeit, fehlt ein Aufräumpfad.
 */
export async function checkOrphanObjects(target: Environment): Promise<CheckResult> {
  const keys = await listObjects(target);
  const referenced = new Set<string>();
  for (const photo of await target.owner.photoEvidence.findMany({ select: { storageKey: true } })) {
    referenced.add(photo.storageKey);
  }
  for (const revision of await target.owner.documentRevision.findMany({
    select: { storageKey: true },
  })) {
    if (revision.storageKey) referenced.add(revision.storageKey);
  }

  const orphans = keys.filter((key) => !referenced.has(key));
  return {
    name: 'Verwaiste Objekte (Hinweis, kein Fehler)',
    passed: true,
    detail: orphans.length === 0 ? 'keine' : `${orphans.length}: ${orphans.slice(0, 5).join(', ')}`,
  };
}

/**
 * Der Audit-Trail muss auf Ressourcen zeigen, die es noch gibt. Geprüft wird
 * an den Arbeitsschritten, weil deren Ereignisse die Kette tragen, um die es
 * in diesem System geht: gestartet, gemeldet, abgeschlossen, freigegeben.
 */
export async function checkAuditReferences(target: Environment): Promise<CheckResult> {
  const dangling = await target.owner.$queryRawUnsafe<{ id: string; event_type: string }[]>(
    `SELECT a.id, a.event_type
       FROM audit_events a
      WHERE a.resource_type = 'work_step_instance'
        AND NOT EXISTS (SELECT 1 FROM work_step_instances w WHERE w.id = a.resource_id)
      LIMIT 10`,
  );

  const total = await target.owner.auditEvent.count();
  return {
    name: 'Audit-Ereignisse zeigen auf vorhandene Arbeitsschritte',
    passed: dangling.length === 0,
    detail:
      dangling.length === 0
        ? `${total} Ereignisse geprüft`
        : `ins Leere: ${dangling.map((d) => `${d.event_type} (${d.id})`).join(', ')}`,
  };
}

/**
 * Die Datei-Hashes: die Datenbank hat bei der Annahme festgehalten, was
 * ankommen sollte. Nach dem Restore muss das Objekt dazu passen — sonst ist
 * die Datei zwar da, aber eine andere.
 */
export async function checkFileHashes(
  target: Environment,
  read: (key: string) => Promise<Buffer>,
  sha256: (buffer: Buffer) => string,
): Promise<CheckResult> {
  const photos = await target.owner.photoEvidence.findMany({
    where: { uploadStatus: 'COMPLETED', fileHashSha256: { not: null } },
    select: { id: true, storageKey: true, fileHashSha256: true },
  });

  const mismatched: string[] = [];
  for (const photo of photos) {
    // Eine Datei, die gar nicht da ist, meldet bereits die vorige Prüfung.
    // Hier darf sie den Lauf nicht abbrechen: ein Bericht mit fünf Befunden
    // ist im Ernstfall mehr wert als ein Stacktrace beim ersten.
    try {
      const actual = sha256(await read(photo.storageKey));
      if (actual !== photo.fileHashSha256) mismatched.push(`photo_evidence ${photo.id}: Hash`);
    } catch (error) {
      mismatched.push(
        `photo_evidence ${photo.id}: nicht lesbar (${error instanceof Error ? error.name : 'Fehler'})`,
      );
    }
  }

  return {
    name: 'Dateiinhalte entsprechen den gespeicherten Hashes',
    passed: mismatched.length === 0,
    detail:
      mismatched.length === 0 ? `${photos.length} Dateien nachgerechnet` : mismatched.join(', '),
  };
}
