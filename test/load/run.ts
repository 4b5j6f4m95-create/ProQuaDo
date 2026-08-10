/**
 * Lasttest nach docs/09_TEST_PYRAMID.md Ebene 8.
 *
 *   pnpm run test:load                      # volle Größe aus docs/09
 *   LOAD_DEVICES=40 pnpm run test:load      # kleiner, für zwischendurch
 *
 * Stellschrauben (alle mit Vorgabe aus docs/09): LOAD_DEVICES=200,
 * LOAD_STEPS=500, LOAD_PHOTOS=2000, LOAD_DASHBOARDS=50,
 * LOAD_DB_CONNECTION_LIMIT=25.
 *
 * **Bewusst nicht in der CI.** Messwerte hängen an der Maschine; ein Gate,
 * das je nach Runner-Auslastung rot wird, erzieht dazu, rote Läufe zu
 * ignorieren — und das ist teurer als ein fehlendes Gate. Die Ziele werden
 * trotzdem geprüft und der Prozess endet mit Exit-Code 1, wenn eines
 * gerissen wird: für einen Lauf von Hand vor einem Release ist das die
 * richtige Härte.
 */

import { assertDockerAvailable, startInfra } from './support/infra';
import { formatMeasurement, printVerdicts, type Verdict } from './support/metrics';

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

async function main(): Promise<void> {
  assertDockerAvailable();

  console.log(
    `Lasttest — ${DEVICES} Geräte, große Akte mit ${STEPS} Schritten und ${PHOTOS} Fotos, ` +
      `${DASHBOARDS} gleichzeitige Dashboards`,
  );
  const startedAt = performance.now();
  const infra = await startInfra();
  console.log(`Infrastruktur bereit, Verbindungsobergrenze ${infra.connectionLimit}`);

  const { seedShiftFixture, seedLargeOrder } = await import('./support/fixtures');
  const { runShiftChangeSync, runLargeDossier, runDashboardUnderLoad, countOutboxEvents } =
    await import('./scenarios');

  const verdicts: Verdict[] = [];
  const notes: string[] = [];

  try {
    console.log(
      `\n[1/4] Ausgangszustand: Aufträge, Zuweisungen, Geräte …` +
        (ORGS > 1 ? ` (verteilt auf ${ORGS} Organisationen)` : ''),
    );
    const perOrg = Math.ceil(DEVICES / ORGS);
    const fixtures = [];
    for (let org = 0; org < ORGS; org += 1) {
      fixtures.push(
        await seedShiftFixture(infra.ownerClient, perOrg, (done, total) => {
          if (done % 25 === 0 || done === total) {
            process.stdout.write(`\r  Organisation ${org + 1}/${ORGS}: ${done}/${total} Geräte`);
          }
        }),
      );
    }
    process.stdout.write('\n');
    const fixture = fixtures[0]!;
    const allDevices = fixtures.flatMap((f) => f.devices);

    console.log('\n[2/4] Szenario: Schichtwechsel-Sync');
    const sync = await runShiftChangeSync(allDevices);
    console.log(`  ${formatMeasurement(sync.measurement)}`);
    console.log(
      `  Outbox-Ereignisse nach dem Schichtwechsel: ${await countOutboxEvents(
        infra.ownerClient,
        fixture.organizationId,
      )}`,
    );
    verdicts.push(...sync.verdicts);

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
  for (const note of notes) console.log(`Hinweis: ${note}`);
  console.log(`Gesamtdauer: ${((performance.now() - startedAt) / 1000).toFixed(0)} s`);

  if (verdicts.some((verdict) => !verdict.passed)) {
    console.error('\nMindestens ein Ziel aus docs/09 Ebene 8 wurde gerissen.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
