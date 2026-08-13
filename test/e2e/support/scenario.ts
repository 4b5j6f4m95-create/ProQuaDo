import './env-init';

import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Actor } from '@/domain/shared/actor';
import { createProductionPlan } from '@/domain/production-plans/create-production-plan';
import { addPlanStep, addPlanStepDependency } from '@/domain/production-plans/plan-steps';
import {
  addChecklistItem,
  addInspectionCharacteristic,
} from '@/domain/production-plans/plan-step-requirements';
import {
  submitProductionPlanForReview,
  approveProductionPlan,
  releaseProductionPlan,
} from '@/domain/production-plans/plan-review-workflow';
import {
  createProductionOrder,
  transitionProductionOrderStatus,
} from '@/domain/production-orders/create-production-order';
import { releaseProductionOrder } from '@/domain/production-orders/release-production-order';
import { assignProductionOrder } from '@/domain/production-orders/assign-production-order';
import { startWorkStep } from '@/domain/execution/start-work-step';
import {
  recordChecklistResponse,
  recordMeasurementResult,
} from '@/domain/execution/capture-evidence';
import { submitWorkStepCompletion } from '@/domain/execution/complete-work-step';
import { createDocument } from '@/domain/documents/create-document';
import { importIfcPlan } from '@/domain/production-plans/import-ifc-plan';
import {
  requestDocumentUploadUrl,
  completeDocumentUpload,
} from '@/domain/documents/document-upload';
import {
  submitDocumentRevisionForReview,
  approveDocumentRevision,
  releaseDocumentRevision,
} from '@/domain/documents/document-review-workflow';
import { DEMO_PIN, DEMO_USERS, type DemoRole } from './auth';

/**
 * Ausgangszustand für die E2E-Tests.
 *
 * Warum die Fixtures hier gebaut werden und nicht auf den vorhandenen
 * Demo-Daten aufsetzen: der Demo-Auftrag aus der lokalen Umgebung ist
 * abgeschlossen und freigegeben — als Vorlage also verbraucht (notes.md,
 * "Zustand der lokalen Demo-Daten"), und ob er überhaupt existiert, hängt
 * davon ab, was vorher jemand von Hand getan hat. Ein Test, dessen
 * Voraussetzung Handarbeit ist, ist kein Test, sondern eine Verabredung.
 *
 * Jeder Lauf legt deshalb seine eigenen Daten an, alle mit dem Präfix `E2E-`.
 * Sie werden bewusst **nicht** wieder gelöscht: Ausführungsdaten hängen an
 * einem append-only Audit-Trail (ADR-004), und ein Testaufräumen, das Zeilen
 * entfernt, deren Nichtlöschbarkeit die eigentliche Zusicherung ist, wäre die
 * falsche Übung. In der Entwicklungsdatenbank sammelt sich damit pro Lauf ein
 * Projekt an — sichtbar, benannt, und mit einer SQL-Zeile wegzuräumen.
 *
 * Angemeldet wird über Keycloak, also müssen die Fixtures den **Demo-Konten**
 * gehören: die Anmeldung bindet an `users.email`, nicht an frisch erfundene
 * Benutzer.
 */

const DEMO_ORG_NAME = 'ProQuaDo Demo GmbH';

// Administrativer Zugang wie in prisma/seed.ts: DIRECT_DATABASE_URL, also die
// schemabesitzende Rolle ohne RLS. Nur für das Anlegen von Stammdaten und für
// Nachlesen in Assertions — die Domänendienste unten laufen über den
// RLS-beschränkten App-Client wie in Produktion.
let ownerClient: PrismaClient | null = null;

function owner(): PrismaClient {
  ownerClient ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL }),
  });
  return ownerClient;
}

/** Verbindungen schließen, damit der Playwright-Worker nicht am Pool hängt. */
export async function closeScenarioDb(): Promise<void> {
  if (ownerClient) {
    await ownerClient.$disconnect();
    ownerClient = null;
  }
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
}

/**
 * Was der **Server** über die Schritte denkt — die Bildschirmanzeige ist die
 * Behauptung, das hier ist die Tatsache. Die zentrale Invariante lautet, dass
 * ein Folgeschritt erst nach serverseitiger Prüfung freigegeben wird; sie nur
 * an einem grünen Kasten im Browser festzumachen, hieße die Behauptung mit
 * sich selbst zu belegen.
 */
export async function readStepStatuses(orderId: string): Promise<string[]> {
  const instances = await owner().workStepInstance.findMany({
    where: { productionOrderId: orderId },
    orderBy: { stepNumber: 'asc' },
    select: { status: true },
  });
  return instances.map((instance) => instance.status);
}

export async function readOrderStatus(orderId: string): Promise<string> {
  const order = await owner().productionOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  return order.status;
}

/** Freigabeentscheidungen eines Auftrags, älteste zuerst. */
export async function readProductReleaseDecisions(
  orderId: string,
): Promise<{ decision: string; reason: string }[]> {
  return owner().productRelease.findMany({
    where: { productionOrderId: orderId },
    orderBy: { decidedAt: 'asc' },
    select: { decision: true, reason: true },
  });
}

/**
 * Setzt das Export-Kontingent einer Rolle zurück.
 *
 * `EXPORT` erlaubt **5 Exporte je Benutzer und Stunde** — und das ist keine
 * Bequemlichkeitsgrenze, sondern das Mittel, auf das sich ADR-007 beruft, wenn
 * es einen synchronen Export für vertretbar erklärt. Der Exporttest verbraucht
 * zwei davon (PDF und ZIP), also wäre der dritte Lauf innerhalb einer Stunde
 * rot — nicht wegen eines Fehlers, sondern weil eine Zusicherung wirkt, die
 * wirken soll.
 *
 * Deshalb wird das Fenster **zurückgesetzt statt angehoben**: die Grenze bleibt
 * im Produktionscode unangetastet und der Test beginnt bei null. Das Gegenteil
 * — die Grenze für Tests hochzudrehen — hieße, etwas anderes zu prüfen als das,
 * was ausgeliefert wird.
 *
 * Der Schlüssel ist der SHA-256 von `<Kategorie>:<Subjekt-ID>`; die Tabelle
 * speichert nie die ID selbst (siehe Schemakommentar zu `RateLimitWindow`).
 * Sie steht außerhalb von RLS, deshalb geht das über den Owner-Client.
 */
export async function resetExportRateLimit(role: DemoRole): Promise<void> {
  const context = await getDemoContext();
  const key = createHash('sha256').update(`EXPORT:${context.actors[role].userId}`).digest('hex');
  await owner().$executeRaw`DELETE FROM rate_limit_windows WHERE key = ${key}`;
}

/**
 * Den PIN-Hash eines Demo-Kontos lesen und zurückschreiben.
 *
 * Nur für den Test der PIN-Selbstvergabe: der ändert notwendigerweise die PIN
 * eines Kontos, und die Demo-Konten teilen sich alle Spezifikationen dieses
 * Laufs (`workers: 1`, dieselben Anmeldungen). Ohne Zurückschreiben stünde
 * `pl.test` danach auf einem anderen Wert als dem in notes.md dokumentierten
 * `1234` — und der nächste Lauf, der damit bestätigen will, wäre rot, ohne
 * dass etwas kaputt ist.
 *
 * Der Hash wird roh bewegt, nicht die PIN: der Test kennt sie danach so wenig
 * wie vorher.
 */
export async function readConfirmationPinHash(role: DemoRole): Promise<string | null> {
  const context = await getDemoContext();
  const user = await owner().user.findUniqueOrThrow({
    where: { id: context.actors[role].userId },
    select: { confirmationPinHash: true },
  });
  return user.confirmationPinHash;
}

export async function restoreConfirmationPinHash(
  role: DemoRole,
  hash: string | null,
): Promise<void> {
  const context = await getDemoContext();
  await owner().user.update({
    where: { id: context.actors[role].userId },
    data: {
      confirmationPinHash: hash,
      confirmationPinFailedAttempts: 0,
      confirmationPinLockedUntil: null,
    },
  });
}

/** Audit-Ereignistypen zu einer Ressource, in Serverzeitfolge. */
export async function readAuditEventTypes(resourceId: string): Promise<string[]> {
  const events = await owner().auditEvent.findMany({
    where: { resourceId },
    orderBy: { serverTimestamp: 'asc' },
    select: { eventType: true },
  });
  return events.map((event) => event.eventType);
}

export interface DemoContext {
  organizationId: string;
  actors: Record<DemoRole, Actor>;
}

let demoContext: DemoContext | null = null;

/**
 * Findet Organisation und Demo-Konten. Schlägt mit einer Anweisung fehl statt
 * mit einem Nullzugriff — wer die E2E-Tests zum ersten Mal startet, hat
 * typischerweise genau den Seed noch nicht laufen lassen.
 */
export async function getDemoContext(): Promise<DemoContext> {
  if (demoContext) return demoContext;

  const organization = await owner().organization.findFirst({
    where: { name: DEMO_ORG_NAME },
  });
  if (!organization) {
    throw new Error(
      `Organisation "${DEMO_ORG_NAME}" nicht gefunden. Vor den E2E-Tests einmal ` +
        '`pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts` ausführen.',
    );
  }

  const users = await owner().user.findMany({
    where: { organizationId: organization.id, email: { in: Object.values(DEMO_USERS) } },
    select: { id: true, email: true },
  });
  const idByEmail = new Map(users.map((user) => [user.email, user.id]));

  const actors = Object.fromEntries(
    Object.entries(DEMO_USERS).map(([role, email]) => {
      const userId = idByEmail.get(email);
      if (!userId) {
        throw new Error(`Demo-Benutzer ${email} fehlt — prisma/seed.ts erneut ausführen.`);
      }
      return [role, { userId, organizationId: organization.id } satisfies Actor];
    }),
  ) as Record<DemoRole, Actor>;

  demoContext = { organizationId: organization.id, actors };
  return demoContext;
}

interface ProjectFixture {
  projectId: string;
  productId: string;
}

/** Eigenes Projekt je Lauf — siehe Kopfkommentar zur Nichtlöschung. */
async function createProject(context: DemoContext): Promise<ProjectFixture> {
  const suffix = randomUUID().slice(0, 8);
  const site = await owner().site.upsert({
    where: { organizationId_code: { organizationId: context.organizationId, code: 'E2E' } },
    update: {},
    create: { organizationId: context.organizationId, code: 'E2E', name: 'E2E-Standort' },
  });
  const customer = await owner().customer.upsert({
    where: {
      organizationId_customerNumber: {
        organizationId: context.organizationId,
        customerNumber: 'E2E-CUST',
      },
    },
    update: {},
    create: {
      organizationId: context.organizationId,
      customerNumber: 'E2E-CUST',
      name: 'E2E Testkunde GmbH',
    },
  });
  const project = await owner().project.create({
    data: {
      organizationId: context.organizationId,
      siteId: site.id,
      customerId: customer.id,
      projectNumber: `E2E-PROJ-${suffix}`,
      name: `E2E-Projekt ${suffix}`,
      createdById: context.actors.projectLead.userId,
      status: 'ACTIVE',
    },
  });
  const product = await owner().product.create({
    data: {
      organizationId: context.organizationId,
      projectId: project.id,
      productNumber: `E2E-PROD-${suffix}`,
      name: 'E2E Gehäuse Baugruppe',
    },
  });

  return { projectId: project.id, productId: product.id };
}

export interface ExecutionScenario {
  orderId: string;
  orderNumber: string;
  serialNumber: string;
  step1InstanceId: string;
  step2InstanceId: string;
  step1Title: string;
  step2Title: string;
  checklistItemText: string;
  characteristicName: string;
}

/**
 * Ein freigegebener Zwei-Schritt-Plan, ein freigegebener Auftrag darauf und
 * `worker.test` als ausführende Person — der Zustand, in dem ein Tablet in der
 * Halle morgens steht.
 *
 * Schritt 1 verlangt Checkliste und Messwert, aber **kein Foto**: die
 * Fotoaufnahme geht über `getUserMedia` und einen presignierten Upload, und
 * ein E2E-Test, der eine Kamera nachstellt, prüft am Ende die Nachstellung.
 * Der Uploadweg hat eigene Integrationstests (Negativtest #7).
 *
 * `completeAllSteps` fährt beide Schritte über die Domänendienste zu Ende —
 * für Tests, deren Gegenstand erst danach beginnt (Produktfreigabe).
 */
export async function createExecutionScenario(
  options: { completeAllSteps?: boolean; startFirstStep?: boolean } = {},
): Promise<ExecutionScenario> {
  const context = await getDemoContext();
  const { projectId, productId } = await createProject(context);
  const { projectLead, qualityManager, productionManager, worker } = context.actors;
  const suffix = randomUUID().slice(0, 8);

  const step1Title = 'Gehäusedeckel montieren';
  const step2Title = 'Endprüfung';
  const checklistItemText = 'Sichtprüfung Gehäuse';
  const characteristicName = 'Spaltmaß';

  const { revision } = await createProductionPlan({
    actor: projectLead,
    projectId,
    productId,
    planNumber: `E2E-FP-${suffix}`,
    name: 'E2E-Montageplan',
  });

  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 1,
    title: step1Title,
    instruction: 'Deckel aufsetzen und mit vier Schrauben fixieren.',
  });
  const step2 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 2,
    title: step2Title,
  });
  await addPlanStepDependency({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    predecessorStepId: step1.id,
    dependentStepId: step2.id,
  });

  const checklistItem = await addChecklistItem({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    planStepId: step1.id,
    itemNumber: 1,
    text: checklistItemText,
  });
  const characteristic = await addInspectionCharacteristic({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    planStepId: step1.id,
    characteristicNumber: 1,
    name: characteristicName,
    nominalValue: '2.0',
    lowerLimit: '1.8',
    upperLimit: '2.2',
    unit: 'mm',
  });

  await submitProductionPlanForReview({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
  });
  await approveProductionPlan({ actor: qualityManager, productionPlanRevisionId: revision.id });
  await releaseProductionPlan({ actor: projectLead, productionPlanRevisionId: revision.id });

  const orderNumber = `E2E-AUF-${suffix}`;
  const serialNumber = `E2E-SN-${suffix}`;
  const order = await createProductionOrder({
    actor: productionManager,
    projectId,
    productId,
    productionPlanRevisionId: revision.id,
    orderNumber,
    serialNumber,
  });
  const planned = await transitionProductionOrderStatus({
    actor: productionManager,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: order.version,
  });
  await releaseProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    expectedVersion: planned.version,
  });
  await assignProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    userId: worker.userId,
    role: 'EXECUTOR',
  });

  const instances = await owner().workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
  });
  const step1InstanceId = instances[0]!.id;
  const step2InstanceId = instances[1]!.id;

  // Der Schritt in Arbeit ist der Bildschirm mit den Formularen — für die
  // Accessibility-Prüfung der interessante Zustand, nicht die Startseite.
  if (options.startFirstStep && !options.completeAllSteps) {
    await startWorkStep({ actor: worker, workStepInstanceId: step1InstanceId });
  }

  if (options.completeAllSteps) {
    await startWorkStep({ actor: worker, workStepInstanceId: step1InstanceId });
    await recordChecklistResponse({
      actor: worker,
      workStepInstanceId: step1InstanceId,
      checklistItemId: checklistItem.id,
      response: 'OK',
    });
    await recordMeasurementResult({
      actor: worker,
      workStepInstanceId: step1InstanceId,
      inspectionCharacteristicId: characteristic.id,
      measuredValue: '2.1',
    });
    await submitWorkStepCompletion({
      actor: worker,
      workStepInstanceId: step1InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });

    await startWorkStep({ actor: worker, workStepInstanceId: step2InstanceId });
    await submitWorkStepCompletion({
      actor: worker,
      workStepInstanceId: step2InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });
  }

  return {
    orderId: order.id,
    orderNumber,
    serialNumber,
    step1InstanceId,
    step2InstanceId,
    step1Title,
    step2Title,
    checklistItemText,
    characteristicName,
  };
}

/**
 * Ein Dokument mit einer DRAFT-Revision **ohne Datei** — der Zustand, in dem
 * der Bildschirm das Upload-Feld anbietet.
 */
export async function createUploadableDocument(): Promise<{
  documentId: string;
  documentNumber: string;
}> {
  const context = await getDemoContext();
  const { projectId } = await createProject(context);
  const suffix = randomUUID().slice(0, 8);
  const documentNumber = `E2E-UP-${suffix}`;

  const { document } = await createDocument({
    actor: context.actors.projectLead,
    projectId,
    documentNumber,
    title: 'E2E Upload-Prüfung',
    firstRevision: { title: 'E2E Upload-Prüfung Rev. 01' },
  });

  return { documentId: document.id, documentNumber };
}

export interface PlanningScenario {
  planRevisionId: string;
  planStepTitle: string;
  documentNumber: string;
  /** So, wie die Auswahlliste den Eintrag beschriftet. */
  revisionOptionLabel: string;
}

/**
 * Ein Plan im Status DRAFT plus eine freigegebene Dokumentrevision im selben
 * Projekt — die Voraussetzung dafür, dass der Planungsbildschirm überhaupt
 * eine Auswahlliste zeigt (`listBindableDocumentRevisions`: nur RELEASED, nur
 * dasselbe Projekt).
 */
export async function createPlanningScenario(): Promise<PlanningScenario> {
  const context = await getDemoContext();
  const { projectId, productId } = await createProject(context);
  const { projectLead } = context.actors;
  const suffix = randomUUID().slice(0, 8);

  const documentTitle = 'E2E Zusammenbauzeichnung';
  const { documentNumber, revisionOptionLabel } = await createReleasedDocument(context, {
    projectId,
    documentNumber: `E2E-ZG-${suffix}`,
    title: documentTitle,
    body: `E2E Zeichnungsinhalt ${suffix}`,
  });

  const planStepTitle = 'Verschraubung nach Zeichnung';
  const { revision: planRevision } = await createProductionPlan({
    actor: projectLead,
    projectId,
    productId,
    planNumber: `E2E-FP-${suffix}`,
    name: 'E2E-Plan mit Dokumentbindung',
  });
  await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 1,
    title: planStepTitle,
  });

  return {
    planRevisionId: planRevision.id,
    planStepTitle,
    documentNumber,
    revisionOptionLabel,
  };
}

interface ReleasedDocument {
  documentId: string;
  documentNumber: string;
  revisionId: string;
  /** So, wie eine Auswahlliste den Eintrag beschriftet. */
  revisionOptionLabel: string;
}

/**
 * Ein Dokument mit **freigegebener** erster Revision und echter Datei im
 * Objektspeicher.
 *
 * Der ganze Weg wird gefahren — hochladen, einreichen, genehmigen, freigeben
 * —, nicht per `UPDATE` gesetzt: eine Revision, die nur im Status RELEASED
 * steht, aber nie durch den Freigabelauf ging, hat keinen `released_at`, keine
 * Genehmigungszeile und keine Datei. Alles drei braucht die Produktionsakte.
 */
async function createReleasedDocument(
  context: DemoContext,
  spec: { projectId: string; documentNumber: string; title: string; body: string },
): Promise<ReleasedDocument> {
  const { projectLead, qualityManager } = context.actors;

  const { document, revision } = await createDocument({
    actor: projectLead,
    projectId: spec.projectId,
    documentNumber: spec.documentNumber,
    title: spec.title,
    firstRevision: { title: spec.title },
  });

  const content = Buffer.from(spec.body);
  const { uploadUrl, storageKey } = await requestDocumentUploadUrl({
    actor: projectLead,
    documentRevisionId: revision.id,
    mimeType: 'text/plain',
  });
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    body: content,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!upload.ok) {
    throw new Error(
      `Upload der Testdatei nach MinIO scheiterte (${upload.status}). Läuft der ` +
        'minio-Container und stimmt S3_ENDPOINT in der .env?',
    );
  }
  await completeDocumentUpload({
    actor: projectLead,
    documentRevisionId: revision.id,
    storageKey,
    mimeType: 'text/plain',
    expectedHashSha256: createHash('sha256').update(content).digest('hex'),
  });
  await submitDocumentRevisionForReview({ actor: projectLead, documentRevisionId: revision.id });
  await approveDocumentRevision({ actor: qualityManager, documentRevisionId: revision.id });
  const released = await releaseDocumentRevision({
    actor: qualityManager,
    documentRevisionId: revision.id,
  });

  return {
    documentId: document.id,
    documentNumber: spec.documentNumber,
    revisionId: revision.id,
    revisionOptionLabel: `${spec.documentNumber} Rev. ${released.revisionNumber} — ${spec.title}`,
  };
}

export interface SupplementScenario {
  orderId: string;
  orderNumber: string;
  stepInstanceId: string;
  stepTitle: string;
  documentNumber: string;
  documentTitle: string;
  revisionOptionLabel: string;
}

/**
 * Der Zustand, in dem eine Unterlage nachgereicht wird: der Plan ist
 * **freigegeben**, der Auftrag läuft, und erst danach kommt die Zulassung.
 *
 * Zwei Eigenschaften sind Absicht und tragen je eine Zusicherung des Tests:
 *
 * 1. **Der Schritt hat keine Dokumentbindung.** Damit steht der Abschnitt
 *    „Verbindliche Unterlagen" gar nicht auf dem Bildschirm — und der
 *    erklärende Satz über den Beilagen darf dann nicht auf ihn verweisen.
 * 2. **Die Dokumentrevision entsteht nach der Planfreigabe.** Vorher gebunden
 *    werden könnte sie ohnehin nicht (`bindDocumentToPlanStep` verlangt
 *    DRAFT); genau deshalb gibt es die Beilage.
 */
export async function createSupplementScenario(): Promise<SupplementScenario> {
  const context = await getDemoContext();
  const { projectId, productId } = await createProject(context);
  const { projectLead, productionManager, worker } = context.actors;
  const suffix = randomUUID().slice(0, 8);

  const stepTitle = 'Modulwand aufrichten';
  const { revision: planRevision } = await createProductionPlan({
    actor: projectLead,
    projectId,
    productId,
    planNumber: `E2E-FP-NA-${suffix}`,
    name: 'E2E-Plan für Nachreichung',
  });
  await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 1,
    title: stepTitle,
    instruction: 'Wandelement aufrichten und verschrauben.',
  });
  await submitProductionPlanForReview({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
  });
  await approveProductionPlan({
    actor: context.actors.qualityManager,
    productionPlanRevisionId: planRevision.id,
  });
  await releaseProductionPlan({ actor: projectLead, productionPlanRevisionId: planRevision.id });

  const orderNumber = `E2E-AUF-NA-${suffix}`;
  const order = await createProductionOrder({
    actor: productionManager,
    projectId,
    productId,
    productionPlanRevisionId: planRevision.id,
    orderNumber,
    serialNumber: `E2E-SN-NA-${suffix}`,
  });
  const planned = await transitionProductionOrderStatus({
    actor: productionManager,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: order.version,
  });
  await releaseProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    expectedVersion: planned.version,
  });
  await assignProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    userId: worker.userId,
    role: 'EXECUTOR',
  });

  const instance = await owner().workStepInstance.findFirstOrThrow({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
  });
  await startWorkStep({ actor: worker, workStepInstanceId: instance.id });

  // Erst jetzt — nach der Planfreigabe und nach Arbeitsbeginn. Das ist der
  // Anlass der Funktion und nicht bloß die bequeme Reihenfolge.
  const documentTitle = 'E2E Zulassung Z-9.1-842';
  const { documentNumber, revisionOptionLabel } = await createReleasedDocument(context, {
    projectId,
    documentNumber: `E2E-ZUL-${suffix}`,
    title: documentTitle,
    body: `E2E Zulassungsinhalt ${suffix}`,
  });

  return {
    orderId: order.id,
    orderNumber,
    stepInstanceId: instance.id,
    stepTitle,
    documentNumber,
    documentTitle,
    revisionOptionLabel,
  };
}

export interface DrawingLookupScenario {
  planRevisionId: string;
  stepTitle: string;
  drawingNumber: string;
}

/**
 * Ein aus einem Gebäudemodell importierter Plan im Entwurf, dessen
 * Zeichnungsverweis beim Import **ins Leere ging** — und eine Zeichnung, die
 * erst danach freigegeben wurde.
 *
 * Die Reihenfolge ist der ganze Fall. Beim Import wird jede im Modell genannte
 * Zeichnung einmal gesucht; fehlt sie, bleibt der Verweis offen. Dass er
 * später wieder aufgegriffen wird, ist die Funktion, die dieser Zustand prüft.
 */
export async function createDrawingLookupScenario(): Promise<DrawingLookupScenario> {
  const context = await getDemoContext();
  const { projectId, productId } = await createProject(context);
  const suffix = randomUUID().slice(0, 8);
  const drawingNumber = `E2E-ZG-NACH-${suffix}`;
  const stepTitle = 'Statische Verschraubung';

  const imported = await importIfcPlan({
    actor: context.actors.projectLead,
    projectId,
    productId,
    planNumber: `E2E-FP-NACH-${suffix}`,
    name: 'E2E-Plan mit offenem Zeichnungsverweis',
    fileName: 'Modul.ifc',
    content: ifcWithDrawing(drawingNumber),
    storageKey: `ifc/e2e/${suffix}.ifc`,
  });
  if (imported.boundDrawingCount !== 0) {
    throw new Error(
      'Der Verweis war schon beim Import gebunden — dann prüft der Test nicht, was er soll.',
    );
  }

  // Erst nach dem Import. Vorher gefunden zu werden ist genau das, was hier
  // nicht passieren darf.
  await createReleasedDocument(context, {
    projectId,
    documentNumber: drawingNumber,
    title: 'E2E Schraubplan Modulboden',
    body: `E2E Zeichnungsinhalt ${suffix}`,
  });

  return { planRevisionId: imported.revisionId, stepTitle, drawingNumber };
}

/**
 * Kleinstmögliche IFC-Datei mit einem Zeichnungsverweis am Bauteil von
 * Schritt 20 — derselbe Aufbau wie in
 * `test/integration/phase8-ifc-import.integration.test.ts`, hier auf das
 * Nötigste gekürzt.
 */
function ifcWithDrawing(drawingNumber: string): Buffer {
  const guid = (prefix: string, id: number): string =>
    (prefix + String(id)).padEnd(22, '0').slice(0, 22);
  const element = (id: number, arbeitsvorgang: string, bauteilId: string): string =>
    [
      `#${id}=IFCBUILDINGELEMENTPROXY('${guid('el', id)}',#5,' ',$,$,#63,#64,$,$);`,
      `#${id + 1}=IFCPROPERTYSINGLEVALUE('Arbeitsvorgang',$,IFCTEXT('${arbeitsvorgang}'),$);`,
      `#${id + 2}=IFCPROPERTYSINGLEVALUE('Allright_Bauteil_ID',$,IFCTEXT('${bauteilId}'),$);`,
      `#${id + 10}=IFCPROPERTYSET('${guid('ps', id + 10)}',#5,'AllplanAttributes',$,(#${id + 1},#${id + 2}));`,
      `#${id + 11}=IFCRELDEFINESBYPROPERTIES('${guid('rd', id + 10)}',#5,$,$,(#${id}),#${id + 10});`,
    ].join('\n');

  return Buffer.from(
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('no view'),'2;1');",
      "FILE_NAME('Modul.ifc','2026-08-13T10:00:00',('E2E'),('No Org',''),'ODA SDAI 25.4','','e2e');",
      "FILE_SCHEMA(('IFC2X3'));",
      'ENDSEC;',
      'DATA;',
      element(100, '20: Statische Verschraubung', 'B-0001'),
      element(300, '130: Kuechen Montage', 'B-0003'),
      `#900=IFCDOCUMENTREFERENCE('${drawingNumber}_Rev01.pdf','${drawingNumber}','E2E Schraubplan Modulboden');`,
      `#901=IFCRELASSOCIATESDOCUMENT('${guid('da', 901)}',#5,$,$,(#100),#900);`,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
    'latin1',
  );
}
