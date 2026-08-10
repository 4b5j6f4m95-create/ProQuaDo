import './env-init';

import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

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
    datasources: { db: { url: process.env.DIRECT_DATABASE_URL } },
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
  const { projectLead, qualityManager } = context.actors;
  const suffix = randomUUID().slice(0, 8);

  const documentNumber = `E2E-ZG-${suffix}`;
  const documentTitle = 'E2E Zusammenbauzeichnung';
  const { revision: documentRevision } = await createDocument({
    actor: projectLead,
    projectId,
    documentNumber,
    title: documentTitle,
    firstRevision: { title: documentTitle },
  });

  const content = Buffer.from(`E2E Zeichnungsinhalt ${suffix}`);
  const { uploadUrl, storageKey } = await requestDocumentUploadUrl({
    actor: projectLead,
    documentRevisionId: documentRevision.id,
    mimeType: 'text/plain',
  });
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    body: content,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!upload.ok) {
    throw new Error(
      `Upload der Testzeichnung nach MinIO scheiterte (${upload.status}). Läuft der ` +
        'minio-Container und stimmt S3_ENDPOINT in der .env?',
    );
  }
  await completeDocumentUpload({
    actor: projectLead,
    documentRevisionId: documentRevision.id,
    storageKey,
    mimeType: 'text/plain',
    expectedHashSha256: createHash('sha256').update(content).digest('hex'),
  });
  await submitDocumentRevisionForReview({
    actor: projectLead,
    documentRevisionId: documentRevision.id,
  });
  await approveDocumentRevision({
    actor: qualityManager,
    documentRevisionId: documentRevision.id,
  });
  const released = await releaseDocumentRevision({
    actor: qualityManager,
    documentRevisionId: documentRevision.id,
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
    revisionOptionLabel: `${documentNumber} Rev. ${released.revisionNumber} — ${documentTitle}`,
  };
}
