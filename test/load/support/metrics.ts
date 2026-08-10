/**
 * Messung und Bewertung. Bewusst klein gehalten: eine Perzentilrechnung, eine
 * Tabelle, ein Urteil je Ziel aus docs/09 Ebene 8.
 *
 * Zwei Festlegungen, die die Zahlen lesbar machen:
 *
 *  - **p95 wird über die nächstliegende Rangzahl gebildet** (nearest-rank),
 *    nicht interpoliert. Bei 200 Messwerten ist das der 190. — ein tatsächlich
 *    gemessener Wert, kein errechneter Zwischenwert, der so nie vorkam.
 *  - **Fehler zählen nicht als schnelle Läufe.** Ein Vorgang, der abbricht,
 *    geht in `failures` und nicht in die Verteilung. Sonst verbessert eine
 *    Überlastung, die Anfragen abweist, ausgerechnet den p95.
 */

export interface Sample {
  durationMs: number;
}

export interface Measurement {
  label: string;
  samples: number[];
  failures: string[];
}

export function createMeasurement(label: string): Measurement {
  return { label, samples: [], failures: [] };
}

/** Misst einen Vorgang und ordnet ihn ein: Dauer oder Fehlergrund. */
export async function measure<T>(
  measurement: Measurement,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    measurement.samples.push(performance.now() - startedAt);
    return result;
  } catch (error) {
    measurement.failures.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

export interface Verdict {
  scenario: string;
  metric: string;
  measured: number;
  target: number;
  /** `count` für Dinge, die keine Zeit sind — Deadlocks, abgewiesene
   *  Kommandos. Ohne das steht in der Ausgabe „0 ms Deadlocks". */
  unit: 'ms' | 's' | 'count';
  passed: boolean;
  note?: string;
}

export function judge(
  scenario: string,
  metric: string,
  measured: number,
  target: number,
  unit: 'ms' | 's' | 'count' = 'ms',
  note?: string,
): Verdict {
  return { scenario, metric, measured, target, unit, passed: measured <= target, note };
}

export function formatMeasurement(measurement: Measurement): string {
  const { label, samples, failures } = measurement;
  if (samples.length === 0) {
    return `${label}: kein einziger Vorgang erfolgreich (${failures.length} Fehler)`;
  }
  const fmt = (value: number) => `${value.toFixed(0)} ms`;
  return [
    `${label}:`,
    `n=${samples.length}`,
    `p50=${fmt(percentile(samples, 50))}`,
    `p95=${fmt(percentile(samples, 95))}`,
    `max=${fmt(Math.max(...samples))}`,
    failures.length > 0 ? `FEHLER=${failures.length}` : 'Fehler=0',
  ].join('  ');
}

/** Häufigste Fehlermeldungen, gekürzt — bei 200 gleichzeitigen Vorgängen
 *  wiederholt sich dieselbe Ursache typischerweise hundertfach. */
export function summarizeFailures(measurement: Measurement, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const failure of measurement.failures) {
    const key = failure.split('\n')[0]!.slice(0, 140);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([message, count]) => `${count}× ${message}`);
}

export function printVerdicts(verdicts: readonly Verdict[]): void {
  const line = '─'.repeat(78);
  console.log(`\n${line}\nErgebnis gegen die Ziele aus docs/09 Ebene 8\n${line}`);
  for (const verdict of verdicts) {
    const measured =
      verdict.unit === 's'
        ? `${(verdict.measured / 1000).toFixed(1)} s`
        : verdict.unit === 'count'
          ? `${verdict.measured}`
          : `${verdict.measured.toFixed(0)} ms`;
    const target =
      verdict.unit === 's'
        ? `< ${(verdict.target / 1000).toFixed(0)} s`
        : verdict.unit === 'count'
          ? `${verdict.target}`
          : `< ${verdict.target.toFixed(0)} ms`;
    console.log(
      `${verdict.passed ? '✓' : '✗'} ${verdict.scenario} — ${verdict.metric}: ${measured} (Ziel ${target})`,
    );
    if (verdict.note) console.log(`    ${verdict.note}`);
  }
  console.log(line);
}
