import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { processSyncCommands } from '@/domain/sync/sync-commands';
import type { SyncCommandEnvelope } from '@/domain/sync/sync-command-types';
import { assembleProductionDossier } from '@/domain/dossier/assemble-dossier';
import { renderDossierPdf } from '@/domain/dossier/render-dossier-pdf';
import { exportProductionDossier } from '@/domain/dossier/export-dossier';
import { getDashboard } from '@/domain/dashboard/dashboard-queries';

import { LOAD_PIN, type DeviceFixture, type ShiftFixture } from './support/fixtures';
import {
  createMeasurement,
  formatMeasurement,
  judge,
  measure,
  percentile,
  summarizeFailures,
  type Measurement,
  type Verdict,
} from './support/metrics';
import {
  messeStapel,
  fasseZeitenZusammen,
  formatZeitbild,
  formatAnweisungen,
  fasseHerkunftZusammen,
  formatHerkunft,
  fasseZugriffeZusammen,
  formatZugriffe,
  fasseWiederholungenZusammen,
  formatWiederholungen,
  setzeGleichzeitigkeitZurueck,
  type Stapelzeit,
  type Zeitbild,
} from './support/zeitnahme';

/**
 * Der Stapel, den ein Tablet nach einer Offline-Schicht abliefert: Schritt
 * starten, Checkliste, Messwert, Abschluss melden. Alle mit **demselben**
 * `baseVersion` — so und nicht anders sendet ein echtes Gerät, dem offline
 * niemand eine neue Version mitteilt (siehe notes.md, „Der Offline-Fluss
 * konnte nie synchronisieren").
 */
function shiftBatch(device: DeviceFixture, baseVersion: number): SyncCommandEnvelope[] {
  const now = new Date();
  return [
    {
      idempotencyKey: randomUUID(),
      commandType: 'start_work_step',
      payload: {
        workStepInstanceId: device.step1InstanceId,
        ...(device.releaseToken ? { releaseToken: device.releaseToken } : {}),
      },
      clientTimestamp: now,
      sequenceNumber: 1,
      baseVersion,
    },
    {
      idempotencyKey: randomUUID(),
      commandType: 'record_checklist_response',
      payload: {
        workStepInstanceId: device.step1InstanceId,
        checklistItemId: device.checklistItemId,
        response: 'OK',
      },
      clientTimestamp: now,
      sequenceNumber: 2,
      baseVersion,
    },
    {
      idempotencyKey: randomUUID(),
      commandType: 'record_measurement_result',
      payload: {
        workStepInstanceId: device.step1InstanceId,
        inspectionCharacteristicId: device.characteristicId,
        measuredValue: '2.05',
      },
      clientTimestamp: now,
      sequenceNumber: 3,
      baseVersion,
    },
    {
      idempotencyKey: randomUUID(),
      commandType: 'submit_completion',
      payload: {
        workStepInstanceId: device.step1InstanceId,
        confirmation: { signatureMethod: 'PIN', pin: LOAD_PIN },
        clientCompletedAt: now,
        usedDocumentRevisionIds: [],
      },
      clientTimestamp: now,
      sequenceNumber: 4,
      baseVersion,
    },
  ];
}

/**
 * Szenario 1 — Schichtwechsel-Sync. Ziel aus docs/09: p95 unter 3 s, keine
 * Deadlocks.
 *
 * Alle Geräte starten gleichzeitig, nicht gestaffelt. Das ist der ungünstige
 * Fall und der realistische zugleich: eine Schicht endet für alle zur selben
 * Minute.
 */
export async function runShiftChangeSync(devices: readonly DeviceFixture[]): Promise<{
  verdicts: Verdict[];
  measurement: Measurement;
  rejected: number;
  /** Für den Wiederholmodus: die beiden Zahlen einer Reihe. Vorher standen
   *  sie nur in der Konsolenausgabe und waren damit nicht zusammenfassbar. */
  p95Ms: number;
  throughputPerSecond: number;
  deadlocks: number;
  /** Wohin die Zeit eines Stapels ging — siehe support/zeitnahme.ts. */
  zeitbild: Zeitbild;
}> {
  const measurement = createMeasurement('Sync-Stapel je Gerät (4 Kommandos)');
  const zeiten: Stapelzeit[] = [];
  // Je Durchgang zurücksetzen: die höchste Gleichzeitigkeit ist eine Aussage
  // über **diesen** Lauf. Ohne das trüge der fünfte Durchgang noch die Spitze
  // des ersten mit sich.
  setzeGleichzeitigkeitZurueck();
  let rejected = 0;
  // Warum ein Kommando nicht angenommen wurde, ist die einzige Auskunft, die
  // hier wirklich weiterhilft — eine nackte Zahl abgewiesener Kommandos ist
  // ein Messwert ohne Handlungsanweisung.
  const reasons = new Map<string, number>();

  const startedAt = performance.now();
  await Promise.all(
    devices.map(async (device) => {
      const results = await measure(measurement, async () => {
        const { ergebnis, zeit } = await messeStapel(() =>
          processSyncCommands({
            actor: device.actor,
            deviceId: device.deviceId,
            commands: shiftBatch(device, device.step1BaseVersion),
          }),
        );
        // Nur erfolgreiche Stapel: ein abgebrochener hat eine Dauer, aber
        // keine, die für die Aufteilung etwas bedeutet — dieselbe Festlegung
        // wie bei `measure` (siehe support/metrics.ts).
        zeiten.push(zeit);
        return ergebnis;
      });
      for (const result of results ?? []) {
        if (result.status === 'ACCEPTED') continue;
        rejected += 1;
        const detail =
          result.errors?.map((e) => `${e.code}: ${e.detail}`).join('; ') ??
          result.conflictType ??
          '(ohne Angabe)';
        const key = `${result.status} — ${detail}`.slice(0, 160);
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
    }),
  );

  const topReasons = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${count}× ${reason}`);

  const deadlocks = measurement.failures.filter((f) => /deadlock|40P01/i.test(f)).length;
  const p95 = percentile(measurement.samples, 95);
  // Durchsatz statt nur Latenz: bei einer Warteschlange sagt er mehr. Ein
  // System, das jeden Stapel gleich langsam beantwortet, ist nicht langsam —
  // es ist voll.
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const throughput = measurement.samples.length / elapsedSeconds;
  console.log(
    `  Durchsatz: ${throughput.toFixed(1)} Stapel/s (${(throughput * 4).toFixed(0)} Kommandos/s)`,
  );
  const zeitbild = fasseZeitenZusammen(zeiten, Number(process.env.DATABASE_POOL_MAX ?? 25));
  console.log(formatZeitbild(zeitbild));
  console.log(formatAnweisungen(zeitbild.anweisungen));
  const herkunft = formatHerkunft(fasseHerkunftZusammen(Math.max(1, zeiten.length)));
  if (herkunft) console.log(herkunft);
  const zugriffe = formatZugriffe(fasseZugriffeZusammen(Math.max(1, zeiten.length)));
  if (zugriffe) console.log(zugriffe);
  const wdh = formatWiederholungen(
    fasseWiederholungenZusammen(zeiten.map((z) => z.genaueAbfragen)),
  );
  if (wdh) console.log(wdh);

  return {
    measurement,
    rejected,
    p95Ms: p95,
    throughputPerSecond: throughput,
    deadlocks,
    zeitbild,
    verdicts: [
      judge(
        'Schichtwechsel-Sync',
        `p95 über ${devices.length} Geräte`,
        p95,
        3_000,
        'ms',
        measurement.failures.length > 0
          ? `${measurement.failures.length} Stapel abgebrochen: ${summarizeFailures(measurement).join(' | ')}`
          : undefined,
      ),
      judge('Schichtwechsel-Sync', 'Deadlocks', deadlocks, 0, 'count'),
      judge(
        'Schichtwechsel-Sync',
        'nicht angenommene Kommandos',
        rejected,
        0,
        'count',
        topReasons.length > 0 ? topReasons.join(' | ') : undefined,
      ),
    ],
  };
}

/**
 * Szenario 2 — große Produktionsakte. Ziel aus docs/09: PDF unter 30 s, ZIP
 * unter 60 s.
 */
export async function runLargeDossier(
  fixture: ShiftFixture,
  bigOrderId: string,
  normalOrderId: string,
): Promise<{ verdicts: Verdict[]; notes: string[] }> {
  const actor = fixture.qualityManager;
  const notes: string[] = [];

  const assemble = createMeasurement('Akte zusammenstellen');
  const dossier = await measure(assemble, () => assembleProductionDossier(actor, bigOrderId));

  const pdf = createMeasurement('PDF erzeugen');
  if (dossier) {
    const buffer = await measure(pdf, () => renderDossierPdf(dossier));
    if (buffer) notes.push(`PDF-Größe: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
  }

  // Der ZIP-Export der großen Akte scheitert absichtlich an der harten Grenze
  // aus ADR-007 (500 Nachweisdateien). Das ist kein Fehlschlag des Tests,
  // sondern der Punkt, an dem docs/09 und die Implementierung sich
  // widersprechen — beides wird gemessen und berichtet.
  const bigZip = createMeasurement('ZIP-Export der großen Akte');
  const bigZipResult = await measure(bigZip, () =>
    exportProductionDossier({ actor, productionOrderId: bigOrderId, format: 'ZIP' }),
  );
  if (!bigZipResult && bigZip.failures.length > 0) {
    notes.push(`ZIP der großen Akte abgelehnt: ${bigZip.failures[0]}`);
  }

  const zip = createMeasurement('ZIP-Export innerhalb der Grenze');
  await measure(zip, () =>
    exportProductionDossier({ actor, productionOrderId: normalOrderId, format: 'ZIP' }),
  );

  console.log(`  ${formatMeasurement(assemble)}`);
  console.log(`  ${formatMeasurement(pdf)}`);
  console.log(`  ${formatMeasurement(zip)}`);

  return {
    notes,
    verdicts: [
      judge(
        'Große Akte',
        'PDF-Erzeugung',
        pdf.samples[0] ?? Number.POSITIVE_INFINITY,
        30_000,
        's',
        pdf.failures[0],
      ),
      judge(
        'Große Akte',
        'ZIP-Export (Auftrag innerhalb der Grenze)',
        zip.samples[0] ?? Number.POSITIVE_INFINITY,
        60_000,
        's',
        zip.failures[0],
      ),
    ],
  };
}

/**
 * Szenario 3 — Dashboard unter Last. Ziel aus docs/09: p95 unter 500 ms bei
 * 50 gleichzeitigen Aufrufen.
 */
export async function runDashboardUnderLoad(
  fixture: ShiftFixture,
  concurrency: number,
): Promise<{ verdicts: Verdict[]; measurement: Measurement }> {
  const measurement = createMeasurement(`Dashboard (${concurrency} gleichzeitig)`);

  await Promise.all(
    Array.from({ length: concurrency }, () =>
      measure(measurement, () => getDashboard(fixture.projectLead)),
    ),
  );

  return {
    measurement,
    verdicts: [
      judge(
        'Dashboard unter Last',
        `p95 über ${concurrency} Aufrufe`,
        percentile(measurement.samples, 95),
        500,
        'ms',
        measurement.failures.length > 0
          ? `${measurement.failures.length} Aufrufe abgebrochen: ${summarizeFailures(measurement).join(' | ')}`
          : undefined,
      ),
    ],
  };
}

/** Wie viele Ereignisse die Outbox aufgenommen hat — die Zahl, an der die
 *  Serialisierung je Organisation hängt (`sync_sequences`, docs/06). */
export async function countOutboxEvents(db: PrismaClient, organizationId: string): Promise<number> {
  return db.outboxEvent.count({ where: { organizationId } });
}
