import { percentile, type Verdict } from './metrics';

/**
 * Mehrere Läufe desselben Szenarios zusammenfassen.
 *
 * **Der Grund steht in notes.md, „Messreihe: welcher Hebel wirklich wirkt":**
 * dieselbe Konfiguration auf derselben Maschine lieferte p95 zwischen 2856 und
 * 3446 ms — also beidseits der Zielmarke von 3000 ms. Ein einzelner Lauf
 * beantwortet die Frage „hält die Zielhardware das Ziel" damit nicht. Er
 * beantwortet sie auch auf der Zielhardware nicht; die Streuung kommt nicht
 * von der Maschine, sondern vom Szenario.
 *
 * Deshalb urteilt diese Zusammenfassung nicht über einen Wert, sondern über
 * eine Reihe — und sie unterscheidet drei Ausgänge, die eine einzelne Zahl
 * ununterscheidbar machen würde:
 *
 *  - **Alle Läufe unter dem Ziel.** Das ist ein Bestehen.
 *  - **Alle Läufe über dem Ziel.** Das ist ein Reißen.
 *  - **Die Reihe liegt beidseits.** Das ist **kein** halbes Bestehen, sondern
 *    die Auskunft, dass die Frage mit dieser Zahl von Läufen nicht entschieden
 *    ist. Genau dieser Fall wurde bisher als „bestanden" oder „gerissen"
 *    gelesen, je nachdem, welchen Lauf man erwischte.
 */

export interface RunResult {
  /** p95 dieses einen Laufs, in Millisekunden. */
  p95Ms: number;
  /** Stapel pro Sekunde in diesem Lauf. */
  throughputPerSecond: number;
  failures: number;
  rejected: number;
  deadlocks: number;
}

export interface RepeatSummary {
  runs: RunResult[];
  p95Median: number;
  p95Min: number;
  p95Max: number;
  /** Spannweite in Prozent des Medians — wie verlässlich die Reihe ist. */
  spreadPercent: number;
  throughputMedian: number;
  outcome: 'unter dem Ziel' | 'über dem Ziel' | 'nicht entschieden';
}

export function summarizeRuns(runs: readonly RunResult[], targetMs: number): RepeatSummary {
  const p95s = runs.map((run) => run.p95Ms);
  const median = percentile(p95s, 50);
  const min = Math.min(...p95s);
  const max = Math.max(...p95s);

  const allUnder = p95s.every((value) => value <= targetMs);
  const allOver = p95s.every((value) => value > targetMs);

  return {
    runs: [...runs],
    p95Median: median,
    p95Min: min,
    p95Max: max,
    spreadPercent: median > 0 ? Math.round(((max - min) / median) * 1000) / 10 : 0,
    throughputMedian: percentile(
      runs.map((run) => run.throughputPerSecond),
      50,
    ),
    outcome: allUnder ? 'unter dem Ziel' : allOver ? 'über dem Ziel' : 'nicht entschieden',
  };
}

/**
 * Das Urteil einer Reihe.
 *
 * **„Nicht entschieden" gilt als nicht bestanden**, und das ist Absicht: der
 * Lasttest endet mit Exit-Code 1, wenn ein Ziel gerissen wird, und eine Reihe,
 * in der einzelne Läufe über dem Ziel liegen, ist kein Beleg dafür, dass die
 * Anlage das Ziel hält. Wer sie trotzdem so lesen will, muss es aussprechen
 * und nicht die Prüfung dazu bringen, es für ihn zu tun.
 */
export function judgeSeries(scenario: string, summary: RepeatSummary, targetMs: number): Verdict {
  const notes = [
    `${summary.runs.length} Läufe: p95 ${summary.p95Min.toFixed(0)}–${summary.p95Max.toFixed(0)} ms ` +
      `(Median ${summary.p95Median.toFixed(0)} ms, Streuung ${summary.spreadPercent} %).`,
  ];
  if (summary.outcome === 'nicht entschieden') {
    notes.push(
      'Die Reihe liegt beidseits der Zielmarke — mit dieser Zahl von Läufen ist die Frage ' +
        'nicht entschieden. Mehr Läufe oder eine ruhigere Maschine, nicht ein anderer Blick ' +
        'auf dieselben Zahlen.',
    );
  }

  return {
    scenario,
    metric: `p95 (Median aus ${summary.runs.length} Läufen)`,
    measured: summary.p95Median,
    target: targetMs,
    unit: 'ms',
    passed: summary.outcome === 'unter dem Ziel',
    note: notes.join(' '),
  };
}

export function formatSeries(summary: RepeatSummary): string {
  const lines = summary.runs.map(
    (run, index) =>
      `  Lauf ${index + 1}: p95 ${run.p95Ms.toFixed(0)} ms · ` +
      `${run.throughputPerSecond.toFixed(1)} Stapel/s · ` +
      `${run.failures} Fehler · ${run.rejected} abgewiesen`,
  );
  lines.push(
    `  Reihe:  p95 ${summary.p95Min.toFixed(0)}–${summary.p95Max.toFixed(0)} ms, ` +
      `Median ${summary.p95Median.toFixed(0)} ms, Streuung ${summary.spreadPercent} % · ` +
      `Durchsatz ${summary.throughputMedian.toFixed(1)} Stapel/s (Median)`,
  );
  return lines.join('\n');
}
