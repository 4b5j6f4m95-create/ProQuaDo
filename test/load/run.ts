/**
 * Lasttest nach docs/09_TEST_PYRAMID.md Ebene 8.
 *
 *   pnpm run test:load                      # volle Größe aus docs/09
 *   LOAD_DEVICES=40 pnpm run test:load      # kleiner, für zwischendurch
 *   LOAD_REPEAT=5 pnpm run test:load        # Sync-Reihe statt Einzelwert
 *
 * Stellschrauben (alle mit Vorgabe aus docs/09): LOAD_DEVICES=200,
 * LOAD_STEPS=500, LOAD_PHOTOS=2000, LOAD_DASHBOARDS=50,
 * LOAD_DB_CONNECTION_LIMIT=25. Dazu LOAD_REPEAT=1 und LOAD_RESULT_FILE.
 *
 * **Bewusst nicht in der CI.** Messwerte hängen an der Maschine; ein Gate,
 * das je nach Runner-Auslastung rot wird, erzieht dazu, rote Läufe zu
 * ignorieren — und das ist teurer als ein fehlendes Gate. Die Ziele werden
 * trotzdem geprüft und der Prozess endet mit Exit-Code 1, wenn eines
 * gerissen wird: für einen Lauf von Hand vor einem Release ist das die
 * richtige Härte.
 *
 * **Warum es `LOAD_REPEAT` gibt.** Der offene Punkt vor dem Piloten ist der
 * Sync-p95 auf der Zielhardware. Ein einzelner Lauf beantwortet ihn nicht:
 * dieselbe Konfiguration auf derselben Maschine lieferte 2856 und 3446 ms —
 * beidseits der Zielmarke von 3000 ms (notes.md, „Messreihe: welcher Hebel
 * wirklich wirkt"). Wer auf der Zielhardware misst und einmal misst, hat
 * gewürfelt. Mit `LOAD_REPEAT` wird der Sync mehrfach gegen je frische
 * Fixtures gefahren und die Reihe zusammengefasst; sie kennt einen dritten
 * Ausgang neben bestanden und gerissen — „nicht entschieden".
 */

import { writeFileSync } from 'node:fs';

import { assertDockerAvailable, startInfra } from './support/infra';
import { formatMeasurement, printVerdicts, type Verdict } from './support/metrics';
import { captureEnvironment, formatEnvironment, warnIfBusy } from './support/environment';
import { summarizeRuns, judgeSeries, formatSeries, type RunResult } from './support/repeat';

// Fixtures und Szenarien werden **nach** dem Start der Infrastruktur geladen.
// `@/lib/db/client` wertet DATABASE_URL beim Auswerten des Moduls aus; statisch
// importiert zeigte der Prisma-Client auf die Adresse aus der lokalen `.env`
// statt auf den frisch gestarteten Container. Dieselbe Reihenfolge wie in den
// Integrationstests.

const DEVICES = Number(process.env.LOAD_DEVICES ?? 200);
const STEPS = Number(process.env.LOAD_STEPS ?? 500);
const PHOTOS = Number(process.env.LOAD_PHOTOS ?? 2000);
const DASHBOARDS = Number(process.env.LOAD_DASHBOARDS ?? 50);
/**
 * Auf wie viele Organisationen die Geräte verteilt werden. Eins ist der
 * Normalfall — eine Fertigung, ein Mandant. Mehr ist das Experiment zur
 * Frage, ob die Outbox-Serialisierung je Organisation (`sync_sequences`,
 * docs/06) den Durchsatz begrenzt: teilt man dieselbe Gerätezahl auf N
 * unabhängige Organisationen auf und steigt der Durchsatz mit N, dann ja.
 */
const ORGS = Number(process.env.LOAD_ORGS ?? 1);
/**
 * Wie oft der Schichtwechsel-Sync wiederholt wird. Eins ist der alte
 * Einzelwert; für eine Entscheidung über die Zielhardware ist er zu wenig.
 * Jede Wiederholung bekommt frische Fixtures — ein zweiter Stapel gegen
 * dieselben Geräte liefe in Versionskonflikte und misste etwas anderes.
 */
const REPEAT = Math.max(1, Number(process.env.LOAD_REPEAT ?? 1));
/** Wohin das maschinenlesbare Ergebnis geschrieben wird. Zwei Läufe auf zwei
 *  Maschinen vergleicht man nicht aus zwei Terminalfenstern. */
const RESULT_FILE = process.env.LOAD_RESULT_FILE;
const SYNC_TARGET_MS = 3_000;

async function main(): Promise<void> {
  assertDockerAvailable();

  console.log(
    `Lasttest — ${DEVICES} Geräte, große Akte mit ${STEPS} Schritten und ${PHOTOS} Fotos, ` +
      `${DASHBOARDS} gleichzeitige Dashboards`,
  );
  const startedAt = performance.now();
  const infra = await startInfra();
  console.log(`Infrastruktur bereit, Verbindungsobergrenze ${infra.connectionLimit}`);

  // Der Steckbrief steht **vor** den Messwerten und nicht danach: wer die
  // Ausgabe abbricht oder nur den Anfang kopiert, soll trotzdem sehen, worauf
  // gemessen wurde.
  const environment = captureEnvironment(infra.connectionLimit);
  console.log(`\n${formatEnvironment(environment)}`);
  const busyWarning = warnIfBusy(environment);
  if (busyWarning) console.log(`\n⚠ ${busyWarning}`);

  const { seedShiftFixture, seedLargeOrder } = await import('./support/fixtures');
  const { runShiftChangeSync, runLargeDossier, runDashboardUnderLoad, countOutboxEvents } =
    await import('./scenarios');

  const verdicts: Verdict[] = [];
  const notes: string[] = [];
  let seriesResult: ReturnType<typeof summarizeRuns> | null = null;
  /** Begründungen abgewiesener Kommandos, über alle Durchgänge entdoppelt. */
  const countNotes = new Set<string>();

  const perOrg = Math.ceil(DEVICES / ORGS);
  const seedFixtureSet = async (round: number) => {
    const label = REPEAT > 1 ? `Durchgang ${round}/${REPEAT} — ` : '';
    const set = [];
    for (let org = 0; org < ORGS; org += 1) {
      set.push(
        await seedShiftFixture(infra.ownerClient, perOrg, (done, total) => {
          if (done % 25 === 0 || done === total) {
            process.stdout.write(
              `\r  ${label}Organisation ${org + 1}/${ORGS}: ${done}/${total} Geräte`,
            );
          }
        }),
      );
    }
    process.stdout.write('\n');
    return set;
  };

  try {
    console.log(
      `\n[1/4] Ausgangszustand: Aufträge, Zuweisungen, Geräte …` +
        (ORGS > 1 ? ` (verteilt auf ${ORGS} Organisationen)` : ''),
    );
    const fixtures = await seedFixtureSet(1);
    const fixture = fixtures[0]!;

    console.log('\n[2/4] Szenario: Schichtwechsel-Sync');
    const runs: RunResult[] = [];
    for (let round = 1; round <= REPEAT; round += 1) {
      // Der erste Durchgang benutzt die Fixtures aus [1/4]; jeder weitere
      // bekommt eigene. Frische Geräte sind keine Feinheit: nach dem ersten
      // Stapel sind die Schrittversionen fortgeschritten, ein zweiter gegen
      // dieselben Geräte würde abgewiesen und misste die Ablehnung.
      const set = round === 1 ? fixtures : await seedFixtureSet(round);
      const sync = await runShiftChangeSync(set.flatMap((f) => f.devices));
      console.log(
        `  ${REPEAT > 1 ? `[${round}/${REPEAT}] ` : ''}${formatMeasurement(sync.measurement)}`,
      );
      runs.push({
        p95Ms: sync.p95Ms,
        throughputPerSecond: sync.throughputPerSecond,
        failures: sync.measurement.failures.length,
        rejected: sync.rejected,
        deadlocks: sync.deadlocks,
      });
      // Die Begründungen der abgewiesenen Kommandos kommen aus den Urteilen
      // des Laufs — aufgehoben, nicht ausgegeben: sie stehen später am
      // zusammengefassten Urteil, damit dieselbe Zeile nicht je Durchgang
      // wiederkehrt.
      for (const verdict of sync.verdicts) {
        if (verdict.unit === 'count' && verdict.note) countNotes.add(verdict.note);
      }
      if (round === 1) {
        console.log(
          `  Outbox-Ereignisse nach dem Schichtwechsel: ${await countOutboxEvents(
            infra.ownerClient,
            fixture.organizationId,
          )}`,
        );
      }
    }

    const series = summarizeRuns(runs, SYNC_TARGET_MS);
    if (REPEAT > 1) console.log(formatSeries(series));
    verdicts.push(judgeSeries('Schichtwechsel-Sync', series, SYNC_TARGET_MS));
    // **Summiert, nicht je Lauf ausgegeben.** Bei fünf Durchgängen stünden
    // sonst fünfmal dieselben zwei Zeilen in der Ergebnistabelle und
    // überdeckten das eine Urteil, um das es geht. Summiert bleibt die Härte
    // dieselbe: das Ziel ist null, und eines ist eines zu viel.
    const over = REPEAT > 1 ? ` (Summe aus ${REPEAT} Läufen)` : '';
    verdicts.push(
      {
        scenario: 'Schichtwechsel-Sync',
        metric: `Deadlocks${over}`,
        measured: runs.reduce((sum, run) => sum + run.deadlocks, 0),
        target: 0,
        unit: 'count',
        passed: runs.every((run) => run.deadlocks === 0),
      },
      {
        scenario: 'Schichtwechsel-Sync',
        metric: `nicht angenommene Kommandos${over}`,
        measured: runs.reduce((sum, run) => sum + run.rejected, 0),
        target: 0,
        unit: 'count',
        passed: runs.every((run) => run.rejected === 0),
        note: countNotes.size > 0 ? [...countNotes].join(' | ') : undefined,
      },
    );
    seriesResult = series;

    console.log('\n[3/4] Szenario: große Produktionsakte');
    const big = await seedLargeOrder(infra.ownerClient, fixture, STEPS, PHOTOS, (done, total) =>
      process.stdout.write(`\r  ${done}/${total} Fotos`),
    );
    process.stdout.write('\n');
    const dossier = await runLargeDossier(fixture, big.orderId, fixture.devices[0]!.orderId);
    verdicts.push(...dossier.verdicts);
    notes.push(...dossier.notes);

    console.log('\n[4/4] Szenario: Dashboard unter Last');
    const dashboard = await runDashboardUnderLoad(fixture, DASHBOARDS);
    console.log(`  ${formatMeasurement(dashboard.measurement)}`);
    verdicts.push(...dashboard.verdicts);
  } finally {
    await infra.stop();
  }

  printVerdicts(verdicts);
  console.log(formatEnvironment(environment));
  for (const note of notes) console.log(`Hinweis: ${note}`);
  if (busyWarning) console.log(`⚠ ${busyWarning}`);
  console.log(`Gesamtdauer: ${((performance.now() - startedAt) / 1000).toFixed(0)} s`);

  if (RESULT_FILE) {
    writeFileSync(
      RESULT_FILE,
      `${JSON.stringify(
        {
          // Kein `new Date()` im Messpfad, aber hier ist der Zeitstempel die
          // halbe Auskunft: ein Ergebnis ohne Datum lässt sich später keiner
          // Hardware und keinem Codestand zuordnen.
          measuredAt: new Date().toISOString(),
          scenarioSizes: {
            devices: DEVICES,
            steps: STEPS,
            photos: PHOTOS,
            dashboards: DASHBOARDS,
            orgs: ORGS,
            repeat: REPEAT,
          },
          environment,
          busyWarning,
          syncSeries: seriesResult,
          verdicts,
          notes,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    console.log(`Ergebnis geschrieben: ${RESULT_FILE}`);
  }

  if (verdicts.some((verdict) => !verdict.passed)) {
    console.error('\nMindestens ein Ziel aus docs/09 Ebene 8 wurde gerissen.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
