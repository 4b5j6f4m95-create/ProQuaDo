import { execFileSync } from 'node:child_process';
import { listObjects, readObject, writeObject, type Environment } from './environment';

/**
 * Sichern und Zurücksichern — beide Speicher, denn beide gehören zusammen.
 *
 * Eine Datenbank ohne ihre Dateien ergibt eine Akte, deren Nachweise im
 * Manifest als `MISSING` stehen: formal lesbar, inhaltlich wertlos. Dateien
 * ohne Datenbank ergeben einen Haufen Bytes ohne Zuordnung. Die Probe sichert
 * deshalb immer beides und misst beide Richtungen.
 */

export interface Backup {
  sql: Buffer;
  objects: Map<string, Buffer>;
}

export async function createBackup(source: Environment): Promise<Backup> {
  // Klartext-Dump statt `-Fc`: er lässt sich lesen, wenn eine Wiederherstellung
  // einmal nicht funktioniert, und die Datenmengen dieses Systems rechtfertigen
  // kein Format, das ein Werkzeug zum Hineinsehen braucht.
  const sql = execFileSync(
    'docker',
    ['exec', source.containerId, 'pg_dump', '-U', 'proquado', '-d', 'proquado'],
    { maxBuffer: 512 * 1024 * 1024 },
  );

  const objects = new Map<string, Buffer>();
  for (const key of await listObjects(source)) {
    objects.set(key, await readObject(source, key));
  }

  return { sql, objects };
}

export async function restoreBackup(target: Environment, backup: Backup): Promise<void> {
  // Die Anwendungsrolle steht **nicht** im Dump: `pg_dump` sichert eine
  // Datenbank, keine Rollen des Clusters. Ohne sie scheitert der erste
  // GRANT — und genau daran scheitert eine Wiederherstellung in der Praxis,
  // wenn niemand sie geübt hat. Siehe docs/12 §3.1.
  execFileSync(
    'docker',
    [
      'exec',
      target.containerId,
      'psql',
      '-U',
      'proquado',
      '-d',
      'proquado',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'proquado_app') " +
        "THEN CREATE ROLE proquado_app LOGIN PASSWORD 'proquado_app_dev_only'; END IF; END $$;",
    ],
    { stdio: 'pipe' },
  );

  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      target.containerId,
      'psql',
      '-U',
      'proquado',
      '-d',
      'proquado',
      '-v',
      'ON_ERROR_STOP=1',
      '--quiet',
    ],
    { input: backup.sql, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  for (const [key, body] of backup.objects) {
    await writeObject(target, key, body);
  }
}
