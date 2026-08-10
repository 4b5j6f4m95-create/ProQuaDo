/**
 * Restore-Probe nach docs/09_TEST_PYRAMID.md Ebene 10.
 *
 *   pnpm run test:restore
 *
 * Der Ablauf ist der, den docs/09 verlangt, und er endet nicht beim
 * erfolgreichen Einspielen: gesichert wird eine Umgebung mit echten Daten,
 * zurückgesichert wird in eine **zweite, leere** Umgebung, und danach wird
 * geprüft, ob dort dasselbe herauskommt.
 *
 *   1. Quellumgebung aufbauen und mit Daten füllen (beide Speicher)
 *   2. Sichern: pg_dump plus alle Objekte
 *   3. Zweite Umgebung starten — leer, ohne Migrationen
 *   4. Zurücksichern
 *   5. Prüfen: Zeilenzahlen, Dateien, Hashes, Audit-Bezüge
 *   6. Dieselbe Produktionsakte in beiden Umgebungen auslesen und vergleichen
 *
 * Punkt 6 ist der eigentliche Beweis. Die Akte wird nie gespeichert, sondern
 * bei jedem Aufruf neu aus den Primärdaten abgeleitet — stimmt sie überein,
 * stimmt alles, woraus sie besteht.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  deleteObject,
  envFor,
  readObject,
  startEnvironment,
  type Environment,
} from './support/environment';
import { createBackup, restoreBackup } from './support/backup';
import {
  checkAuditReferences,
  checkFileHashes,
  checkOrphanObjects,
  checkReferencedFilesExist,
  compareCounts,
  countRows,
  type CheckResult,
} from './support/checks';

interface SeedResult {
  organizationId: string;
  orderId: string;
  qmUserId: string;
  documentRevisionId: string;
}

function runSubprocess(script: string, environment: Environment, args: string[] = []): string {
  return execFileSync('pnpm', ['exec', 'tsx', script, ...args], {
    env: envFor(environment),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  const results: CheckResult[] = [];

  console.log('[1/6] Quellumgebung …');
  const source = await startEnvironment('source', { applyMigrations: true });
  let target: Environment | undefined;

  try {
    const seed = JSON.parse(
      runSubprocess('test/restore/subprocess/seed-source.ts', source),
    ) as SeedResult;
    console.log(`      Auftrag ${seed.orderId}`);

    console.log('[2/6] Sichern …');
    const backup = await createBackup(source);
    console.log(
      `      ${(backup.sql.byteLength / 1024).toFixed(0)} kB SQL, ${backup.objects.size} Objekte`,
    );

    console.log('[3/6] Zielumgebung (leer, ohne Migrationen) …');
    target = await startEnvironment('target', { applyMigrations: false });

    console.log('[4/6] Zurücksichern …');
    await restoreBackup(target, backup);
    await injectFaultIfRequested(target);

    console.log('[5/6] Integrität prüfen …');
    const sourceCounts = await countRows(source.owner);
    const targetCounts = await countRows(target.owner);
    results.push(compareCounts(sourceCounts, targetCounts));
    results.push(await record('Referenzierte Dateien', () => checkReferencedFilesExist(target!)));
    results.push(
      await record('Dateihashes', () =>
        checkFileHashes(
          target!,
          (key) => readObject(target!, key),
          (buffer) => createHash('sha256').update(buffer).digest('hex'),
        ),
      ),
    );
    results.push(await record('Audit-Bezüge', () => checkAuditReferences(target!)));
    results.push(await record('Verwaiste Objekte', () => checkOrphanObjects(target!)));

    console.log('[6/6] Produktionsakte vergleichen …');
    const args = [seed.orderId, seed.qmUserId, seed.organizationId];
    const before = runSubprocess('test/restore/subprocess/read-dossier.ts', source, args);
    const after = runSubprocess('test/restore/subprocess/read-dossier.ts', target, args);
    results.push({
      name: 'Produktionsakte vor und nach dem Restore identisch',
      passed: before === after,
      detail:
        before === after
          ? `${(before.length / 1024).toFixed(1)} kB JSON, zeichengleich`
          : firstDifference(before, after),
    });
  } finally {
    await source.stop();
    await target?.stop();
  }

  const line = '─'.repeat(78);
  console.log(`\n${line}\nRestore-Probe (docs/09 Ebene 10)\n${line}`);
  for (const result of results) {
    console.log(`${result.passed ? '✓' : '✗'} ${result.name}`);
    console.log(`    ${result.detail}`);
  }
  console.log(line);
  console.log(`Gesamtdauer: ${((performance.now() - startedAt) / 1000).toFixed(0)} s`);

  if (results.some((result) => !result.passed)) {
    console.error('\nDie Restore-Probe ist fehlgeschlagen.');
    process.exitCode = 1;
  }
}

/**
 * Führt eine Prüfung aus und macht aus einer Ausnahme einen Befund statt eines
 * Abbruchs. Am Tag des Ausfalls will man alle Abweichungen auf einmal sehen,
 * nicht eine nach der anderen über mehrere Läufe.
 */
async function record(name: string, check: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await check();
  } catch (error) {
    return {
      name: `${name} — Prüfung abgebrochen`,
      passed: false,
      detail: error instanceof Error ? error.message.split('\n')[0]! : String(error),
    };
  }
}

/**
 * Beschädigt den Restore absichtlich — damit prüfbar bleibt, dass die Probe
 * überhaupt anschlägt.
 *
 *   RESTORE_DRILL_FAULT=missing-file pnpm run test:restore
 *   RESTORE_DRILL_FAULT=missing-row  pnpm run test:restore
 *
 * Beide Läufe **müssen** rot enden. Eine Wiederherstellungsprüfung, die noch
 * nie fehlgeschlagen ist, hat dasselbe Problem wie ein Test ohne Zusicherung:
 * sie sieht aus wie eine Kontrolle. Der grüne Normallauf beweist, dass der
 * Restore funktioniert; diese beiden beweisen, dass die Aussage etwas wert
 * ist.
 */
async function injectFaultIfRequested(target: Environment): Promise<void> {
  const fault = process.env.RESTORE_DRILL_FAULT?.trim();
  if (!fault) return;

  if (fault === 'missing-file') {
    const photo = await target.owner.photoEvidence.findFirstOrThrow({
      select: { storageKey: true },
    });
    await deleteObject(target, photo.storageKey);
    console.log(`      ⚠ Fehler eingeschleust: Objekt ${photo.storageKey} gelöscht`);
    return;
  }

  if (fault === 'missing-row') {
    const measurement = await target.owner.measurementResult.findFirstOrThrow({
      select: { id: true },
    });
    await target.owner.measurementResult.delete({ where: { id: measurement.id } });
    console.log(`      ⚠ Fehler eingeschleust: Messwert ${measurement.id} gelöscht`);
    return;
  }

  throw new Error(`Unbekannter RESTORE_DRILL_FAULT: ${fault}`);
}

/** Wo genau die Akten auseinandergehen — eine Fundstelle ist mehr wert als
 *  zwei Kilobyte JSON nebeneinander. */
function firstDifference(before: string, after: string): string {
  const index = [...before].findIndex((char, position) => char !== after[position]);
  const at = index === -1 ? Math.min(before.length, after.length) : index;
  const window = 90;
  return (
    `erste Abweichung bei Zeichen ${at}\n` +
    `      Quelle: …${before.slice(Math.max(0, at - 20), at + window)}\n` +
    `      Ziel:   …${after.slice(Math.max(0, at - 20), at + window)}`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
