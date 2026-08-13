import { execSync } from 'node:child_process';
import os from 'node:os';

/**
 * Steckbrief der Maschine, auf der gemessen wurde.
 *
 * **Ohne ihn ist eine Messzahl nicht vergleichbar und damit wertlos.** Der
 * offene Punkt aus docs/09 lautet nicht „ist der p95 unter 3 s", sondern „ist
 * er es auf der Zielhardware" — und diese Frage lässt sich an einer Zahl
 * allein nicht ablesen. Wer später zwei Läufe nebeneinanderlegt, muss sehen,
 * ob er zwei Maschinen vergleicht oder zwei Konfigurationen.
 *
 * Aufgenommen wird nur, was das Ergebnis erklären kann: Kerne und Takt (der
 * Sync ist zu großen Teilen CPU-gebunden), Arbeitsspeicher, Node- und
 * Docker-Fassung, und die drei Stellschrauben, die in der Messreihe vom
 * 10.08.2026 überhaupt gewirkt haben.
 */

export interface EnvironmentFingerprint {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryGb: number;
  loadAverage1m: number;
  nodeVersion: string;
  dockerVersion: string;
  /** Node-eigener Threadpool — 5 % Gewinn bei 16, siehe notes.md. */
  uvThreadpoolSize: string;
  databasePoolMax: string;
  connectionLimit: number;
}

export function captureEnvironment(connectionLimit: number): EnvironmentFingerprint {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model.trim() ?? 'unbekannt',
    cpuCount: cpus.length,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    // Die Vorlast zum Startzeitpunkt. Eine Messung auf einer Maschine, die
    // schon arbeitet, misst nicht die Maschine — und genau das war der Fehler
    // hinter zwei falschen Schlüssen in der ersten Messreihe.
    loadAverage1m: Math.round(os.loadavg()[0]! * 100) / 100,
    nodeVersion: process.version,
    dockerVersion: readDockerVersion(),
    uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? '(nicht gesetzt, Vorgabe 4)',
    databasePoolMax: process.env.DATABASE_POOL_MAX ?? '(nicht gesetzt)',
    connectionLimit,
  };
}

function readDockerVersion(): string {
  try {
    return execSync('docker --version', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unbekannt';
  }
}

export function formatEnvironment(env: EnvironmentFingerprint): string {
  const line = '─'.repeat(78);
  return [
    line,
    'Gemessen auf',
    line,
    `  Maschine    ${env.hostname} · ${env.platform} ${env.release} · ${env.arch}`,
    `  CPU         ${env.cpuModel} · ${env.cpuCount} Kerne · Vorlast ${env.loadAverage1m}`,
    `  Speicher    ${env.totalMemoryGb} GB`,
    `  Node        ${env.nodeVersion}`,
    `  Docker      ${env.dockerVersion}`,
    `  UV_THREADPOOL_SIZE=${env.uvThreadpoolSize} · DATABASE_POOL_MAX=${env.databasePoolMax} · connection_limit=${env.connectionLimit}`,
    line,
  ].join('\n');
}

/**
 * Warnt, wenn die Maschine schon vor der Messung beschäftigt ist.
 *
 * Kein Abbruch: wer auf einem Server misst, auf dem noch etwas anderes läuft,
 * hat dafür womöglich einen Grund. Aber die Zahl darf dann nicht als Urteil
 * über die Hardware gelesen werden.
 */
export function warnIfBusy(env: EnvironmentFingerprint): string | null {
  const perCore = env.loadAverage1m / env.cpuCount;
  if (perCore < 0.3) return null;
  return (
    `Die Maschine war beim Start bereits ausgelastet (Vorlast ${env.loadAverage1m} auf ` +
    `${env.cpuCount} Kernen). Die Messwerte sagen dann etwas über diesen Zustand und ` +
    'nicht über die Hardware — vor einer Entscheidung im Leerlauf wiederholen.'
  );
}
