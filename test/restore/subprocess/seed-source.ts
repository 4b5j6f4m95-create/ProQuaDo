/**
 * Legt in der Quellumgebung einen Datenbestand an, der beide Speicher
 * berührt: Dokument mit Datei, Auftrag mit Fotonachweis und Messwert,
 * Abschluss mit PIN-Bestätigung, Produktfreigabe, dazu Audit-Trail und
 * Outbox.
 *
 * Läuft als **eigener Prozess**, weil `@/lib/db/client` seine Verbindung beim
 * Auswerten des Moduls festlegt: Quelle und Ziel im selben Prozess wären
 * dieselbe Datenbank. Die Ausgabe ist eine Zeile JSON auf stdout.
 */

import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Actor } from '@/domain/shared/actor';
import { seedOrganizationRbac, seedDemoUsers } from '@/domain/identity/seed-organization';
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
import { createProductionPlan } from '@/domain/production-plans/create-production-plan';
import { addPlanStep, addPlanStepDependency } from '@/domain/production-plans/plan-steps';
import {
  addChecklistItem,
  addInspectionCharacteristic,
  addPhotoRequirement,
  bindDocumentToPlanStep,
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
import { requestPhotoUploadUrl, completePhotoUpload } from '@/domain/execution/photo-evidence';
import { submitWorkStepCompletion } from '@/domain/execution/complete-work-step';
import { decideProductRelease } from '@/domain/quality/product-release';

const PIN = '1234';

async function main(): Promise<void> {
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL }),
  });
  const suffix = randomUUID().slice(0, 8);

  const seeded = await seedOrganizationRbac(owner, `restore-${suffix}`);
  const userIds = await seedDemoUsers(owner, seeded, [
    { email: 'pl@restore.local', displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    {
      email: 'qm@restore.local',
      displayName: 'QM',
      roleCode: 'QUALITY_MANAGER',
      confirmationPin: PIN,
    },
    { email: 'pm@restore.local', displayName: 'PM', roleCode: 'PRODUCTION_MANAGER' },
    {
      email: 'worker@restore.local',
      displayName: 'Worker',
      roleCode: 'WORKER',
      confirmationPin: PIN,
    },
  ]);
  const actor = (email: string): Actor => ({
    userId: userIds[email]!,
    organizationId: seeded.organizationId,
  });
  const pl = actor('pl@restore.local');
  const qm = actor('qm@restore.local');
  const pm = actor('pm@restore.local');
  const worker = actor('worker@restore.local');

  const site = await owner.site.create({
    data: { organizationId: seeded.organizationId, code: `R-${suffix}`, name: 'Restore-Werk' },
  });
  const customer = await owner.customer.create({
    data: {
      organizationId: seeded.organizationId,
      customerNumber: `R-C-${suffix}`,
      name: 'Restore-Kunde',
    },
  });
  const project = await owner.project.create({
    data: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      customerId: customer.id,
      projectNumber: `R-P-${suffix}`,
      name: 'Restore-Projekt',
      createdById: pl.userId,
      status: 'ACTIVE',
    },
  });
  const product = await owner.product.create({
    data: {
      organizationId: seeded.organizationId,
      projectId: project.id,
      productNumber: `R-PR-${suffix}`,
      name: 'Restore-Baugruppe',
    },
  });

  // Dokument mit echter Datei im Objektspeicher
  const { revision: docRevision } = await createDocument({
    actor: pl,
    projectId: project.id,
    documentNumber: `R-ZG-${suffix}`,
    title: 'Restore-Zeichnung',
    firstRevision: { title: 'Restore-Zeichnung Rev. 01' },
  });
  const drawing = Buffer.from(`Zeichnungsinhalt ${suffix}`);
  const upload = await requestDocumentUploadUrl({
    actor: pl,
    documentRevisionId: docRevision.id,
    mimeType: 'text/plain',
  });
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: drawing,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!put.ok) throw new Error(`Upload der Zeichnung scheiterte: ${put.status}`);
  await completeDocumentUpload({
    actor: pl,
    documentRevisionId: docRevision.id,
    storageKey: upload.storageKey,
    mimeType: 'text/plain',
    expectedHashSha256: createHash('sha256').update(drawing).digest('hex'),
  });
  await submitDocumentRevisionForReview({ actor: pl, documentRevisionId: docRevision.id });
  await approveDocumentRevision({ actor: qm, documentRevisionId: docRevision.id });
  await releaseDocumentRevision({ actor: qm, documentRevisionId: docRevision.id });

  // Plan mit allen Nachweisarten
  const { revision: planRevision } = await createProductionPlan({
    actor: pl,
    projectId: project.id,
    productId: product.id,
    planNumber: `R-FP-${suffix}`,
    name: 'Restore-Plan',
  });
  const step1 = await addPlanStep({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 1,
    title: 'Montage',
  });
  const step2 = await addPlanStep({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 2,
    title: 'Endprüfung',
  });
  await addPlanStepDependency({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    predecessorStepId: step1.id,
    dependentStepId: step2.id,
  });
  const checklistItem = await addChecklistItem({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    itemNumber: 1,
    text: 'Sichtprüfung',
  });
  const photoRequirement = await addPhotoRequirement({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    category: 'TYPENSCHILD',
    minCount: 1,
  });
  const characteristic = await addInspectionCharacteristic({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    characteristicNumber: 1,
    name: 'Spaltmaß',
    nominalValue: '2.0',
    lowerLimit: '1.8',
    upperLimit: '2.2',
    unit: 'mm',
  });
  await bindDocumentToPlanStep({
    actor: pl,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    documentRevisionId: docRevision.id,
  });
  await submitProductionPlanForReview({ actor: pl, productionPlanRevisionId: planRevision.id });
  await approveProductionPlan({ actor: qm, productionPlanRevisionId: planRevision.id });
  await releaseProductionPlan({ actor: pl, productionPlanRevisionId: planRevision.id });

  // Auftrag, Ausführung, Nachweise
  const order = await createProductionOrder({
    actor: pm,
    projectId: project.id,
    productId: product.id,
    productionPlanRevisionId: planRevision.id,
    orderNumber: `R-AUF-${suffix}`,
    serialNumber: `R-SN-${suffix}`,
  });
  const planned = await transitionProductionOrderStatus({
    actor: pm,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: order.version,
  });
  await releaseProductionOrder({
    actor: pm,
    productionOrderId: order.id,
    expectedVersion: planned.version,
  });
  await assignProductionOrder({
    actor: pm,
    productionOrderId: order.id,
    userId: worker.userId,
    role: 'EXECUTOR',
  });

  const instances = await owner.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
    select: { id: true },
  });
  const first = instances[0]!.id;
  const second = instances[1]!.id;

  await startWorkStep({ actor: worker, workStepInstanceId: first });
  await recordChecklistResponse({
    actor: worker,
    workStepInstanceId: first,
    checklistItemId: checklistItem.id,
    response: 'OK',
  });
  const photo = Buffer.from(`Foto ${suffix}`);
  const photoUpload = await requestPhotoUploadUrl({
    actor: worker,
    workStepInstanceId: first,
    mimeType: 'image/jpeg',
    photoRequirementId: photoRequirement.id,
  });
  const photoPut = await fetch(photoUpload.uploadUrl, {
    method: 'PUT',
    body: photo,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (!photoPut.ok) throw new Error(`Foto-Upload scheiterte: ${photoPut.status}`);
  await completePhotoUpload({
    actor: worker,
    photoEvidenceId: photoUpload.photoEvidenceId,
    expectedHashSha256: createHash('sha256').update(photo).digest('hex'),
  });
  await recordMeasurementResult({
    actor: worker,
    workStepInstanceId: first,
    inspectionCharacteristicId: characteristic.id,
    measuredValue: '2.05',
  });
  await submitWorkStepCompletion({
    actor: worker,
    workStepInstanceId: first,
    idempotencyKey: randomUUID(),
    confirmation: { signatureMethod: 'PIN', pin: PIN },
    usedDocumentRevisionIds: [docRevision.id],
  });

  await startWorkStep({ actor: worker, workStepInstanceId: second });
  await submitWorkStepCompletion({
    actor: worker,
    workStepInstanceId: second,
    idempotencyKey: randomUUID(),
    confirmation: { signatureMethod: 'PIN', pin: PIN },
    usedDocumentRevisionIds: [],
  });

  await decideProductRelease({
    actor: qm,
    productionOrderId: order.id,
    decision: 'RELEASED',
    reason: 'Alle Nachweise vollständig, Restore-Probe.',
    pin: PIN,
  });

  await owner.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();

  process.stdout.write(
    JSON.stringify({
      organizationId: seeded.organizationId,
      orderId: order.id,
      qmUserId: qm.userId,
      documentRevisionId: docRevision.id,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
