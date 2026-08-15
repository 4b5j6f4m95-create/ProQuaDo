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
  /**
   * Die CPU-Quote der Container, falls gesetzt — die Stellschraube der
   * Skalierungsmessung. Sie **muss** hier stehen: zwei Läufe mit einer und
   * mit zwei CPUs unterscheiden sich sonst in keinem aufgezeichneten Feld,
   * und der Vergleich, für den sie gemacht wurden, wäre nicht mehr
   * nachvollziehbar. `os.cpus()` hilft nicht, denn die Quote beschränkt die
   * Container, nicht die Maschine.
   */
  containerCpuQuota: string;
}

/**
 * @param baselineLoad Vorlast **vor** dem Start der Infrastruktur. Ohne
 *   diesen Wert wäre die Angabe irreführend: `startInfra()` fährt zwei
 *   Container hoch und spielt die Migrationen ein, und auf einer kleinen
 *   Maschine hebt allein das die Ein-Minuten-Vorlast über die Schwelle.
 *   Gemessen wurde dann teils das Werkzeug statt die Maschine — auf der
 *   Zielhardware meldete der Lauf 1,37, während unmittelbar vor dem Start
 *   0,42 anlag. Die Warnung schlug damit fast immer an und wurde dadurch
 *   wertlos.
 */
export function captureEnvironment(
  connectionLimit: number,
  baselineLoad: number,
): EnvironmentFingerprint {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model.trim() ?? 'unbekannt',
    cpuCount: cpus.length,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    // Die Vorlast **vor** dem Start der Infrastruktur, hereingereicht statt
    // hier gelesen — siehe den Parameterkommentar oben.
    loadAverage1m: Math.round(baselineLoad * 100) / 100,
    nodeVersion: process.version,
    dockerVersion: readDockerVersion(),
    uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? '(nicht gesetzt, Vorgabe 4)',
    databasePoolMax: process.env.DATABASE_POOL_MAX ?? '(nicht gesetzt)',
    connectionLimit,
    containerCpuQuota: process.env.LOAD_CPU_QUOTA ?? '(keine, Container nutzen die ganze Maschine)',
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
    `  Container   CPU-Quote ${env.containerCpuQuota}`,
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
