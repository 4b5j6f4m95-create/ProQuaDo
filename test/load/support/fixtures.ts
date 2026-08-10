import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import type { Actor } from '@/domain/shared/actor';
import { seedOrganizationRbac, seedDemoUsers } from '@/domain/identity/seed-organization';
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
import { registerDevice, MAX_ACTIVE_DEVICES_PER_USER } from '@/domain/sync/device-registry';
import { putObjectBytes } from '@/lib/storage/object-storage';

export const LOAD_PIN = '1234';

/** Ein Gerät mit dem Auftrag, den es abarbeitet — ein Tablet einer Schicht. */
export interface DeviceFixture {
  deviceId: string;
  actor: Actor;
  orderId: string;
  step1InstanceId: string;
  step2InstanceId: string;
  checklistItemId: string;
  characteristicId: string;
  releaseToken: string | undefined;
  /** Die Version, die der Schritt beim Vorbereiten hatte — genau das, was ein
   *  Gerät aus dem Offline-Bundle mitnimmt und in jedem Kommando des Stapels
   *  als `baseVersion` mitschickt. Nicht 1: die Auftragsfreigabe hat den
   *  Schritt bereits auf READY gehoben. */
  step1BaseVersion: number;
}

export interface ShiftFixture {
  organizationId: string;
  projectLead: Actor;
  qualityManager: Actor;
  productionManager: Actor;
  devices: DeviceFixture[];
}

/**
 * Der Zustand vor dem Schichtwechsel: `deviceCount` Tablets, jedes mit einem
 * eigenen freigegebenen Auftrag und einem wartenden Stapel.
 *
 * **Warum mehrere Benutzer.** `MAX_ACTIVE_DEVICES_PER_USER` liegt bei 10 —
 * bewusst, siehe device-registry.ts. 200 Geräte brauchen deshalb mindestens
 * 20 Konten. Das ist keine Umgehung der Grenze, sondern die Nachbildung
 * dessen, was in einer Halle steht: Geräte gehören Personen.
 */
export async function seedShiftFixture(
  db: PrismaClient,
  deviceCount: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ShiftFixture> {
  const workerCount = Math.ceil(deviceCount / MAX_ACTIVE_DEVICES_PER_USER);
  const seeded = await seedOrganizationRbac(db, `load-${randomUUID().slice(0, 8)}`);

  const userIds = await seedDemoUsers(db, seeded, [
    { email: 'pl@load.local', displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    { email: 'qm@load.local', displayName: 'QM', roleCode: 'QUALITY_MANAGER' },
    { email: 'pm@load.local', displayName: 'PM', roleCode: 'PRODUCTION_MANAGER' },
    ...Array.from({ length: workerCount }, (_, index) => ({
      email: `worker${index}@load.local`,
      displayName: `Worker ${index}`,
      roleCode: 'WORKER' as const,
      confirmationPin: LOAD_PIN,
    })),
  ]);

  const actor = (email: string): Actor => ({
    userId: userIds[email]!,
    organizationId: seeded.organizationId,
  });
  const projectLead = actor('pl@load.local');
  const qualityManager = actor('qm@load.local');
  const productionManager = actor('pm@load.local');

  const { projectId, productId } = await createProjectAndProduct(
    db,
    seeded.organizationId,
    projectLead.userId,
  );

  // Ein Plan für alle Aufträge — Fertigungspläne sind wiederverwendbar, und
  // 200 Pläne zu bauen misst das Anlegen, nicht den Schichtwechsel.
  const plan = await seedTwoStepPlan(projectLead, qualityManager, projectId, productId);

  const devices: DeviceFixture[] = [];
  for (let index = 0; index < deviceCount; index += 1) {
    const worker = actor(`worker${Math.floor(index / MAX_ACTIVE_DEVICES_PER_USER)}@load.local`);
    const order = await seedReleasedOrder(db, {
      productionManager,
      worker,
      projectId,
      productId,
      planRevisionId: plan.revisionId,
      index,
    });
    const device = await registerDevice({ actor: worker, deviceLabel: `Tablet ${index}` });

    devices.push({
      deviceId: device.deviceId,
      actor: worker,
      orderId: order.orderId,
      step1InstanceId: order.step1InstanceId,
      step2InstanceId: order.step2InstanceId,
      checklistItemId: plan.checklistItemId,
      characteristicId: plan.characteristicId,
      releaseToken: order.releaseToken,
      step1BaseVersion: order.step1Version,
    });
    onProgress?.(index + 1, deviceCount);
  }

  return {
    organizationId: seeded.organizationId,
    projectLead,
    qualityManager,
    productionManager,
    devices,
  };
}

async function createProjectAndProduct(
  db: PrismaClient,
  organizationId: string,
  createdById: string,
): Promise<{ projectId: string; productId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const site = await db.site.create({
    data: { organizationId, code: `LOAD-${suffix}`, name: 'Lastwerk' },
  });
  const customer = await db.customer.create({
    data: { organizationId, customerNumber: `LOAD-C-${suffix}`, name: 'Lastkunde GmbH' },
  });
  const project = await db.project.create({
    data: {
      organizationId,
      siteId: site.id,
      customerId: customer.id,
      projectNumber: `LOAD-P-${suffix}`,
      name: 'Lasttestprojekt',
      createdById,
      status: 'ACTIVE',
    },
  });
  const product = await db.product.create({
    data: {
      organizationId,
      projectId: project.id,
      productNumber: `LOAD-PR-${suffix}`,
      name: 'Lastbaugruppe',
    },
  });
  return { projectId: project.id, productId: product.id };
}

async function seedTwoStepPlan(
  projectLead: Actor,
  qualityManager: Actor,
  projectId: string,
  productId: string,
) {
  const { revision } = await createProductionPlan({
    actor: projectLead,
    projectId,
    productId,
    planNumber: `LOAD-FP-${randomUUID().slice(0, 8)}`,
    name: 'Lastplan',
  });
  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 1,
    title: 'Montage',
  });
  const step2 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 2,
    title: 'Endprüfung',
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
    text: 'Sichtprüfung',
  });
  const characteristic = await addInspectionCharacteristic({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    planStepId: step1.id,
    characteristicNumber: 1,
    name: 'Spaltmaß',
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

  return {
    revisionId: revision.id,
    checklistItemId: checklistItem.id,
    characteristicId: characteristic.id,
  };
}

async function seedReleasedOrder(
  db: PrismaClient,
  params: {
    productionManager: Actor;
    worker: Actor;
    projectId: string;
    productId: string;
    planRevisionId: string;
    index: number;
  },
) {
  const order = await createProductionOrder({
    actor: params.productionManager,
    projectId: params.projectId,
    productId: params.productId,
    productionPlanRevisionId: params.planRevisionId,
    orderNumber: `LOAD-A-${String(params.index).padStart(4, '0')}-${randomUUID().slice(0, 6)}`,
    serialNumber: `LOAD-SN-${String(params.index).padStart(4, '0')}`,
  });
  const planned = await transitionProductionOrderStatus({
    actor: params.productionManager,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: order.version,
  });
  const released = await releaseProductionOrder({
    actor: params.productionManager,
    productionOrderId: order.id,
    expectedVersion: planned.version,
  });
  await assignProductionOrder({
    actor: params.productionManager,
    productionOrderId: order.id,
    userId: params.worker.userId,
    role: 'EXECUTOR',
  });

  const instances = await db.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
    select: { id: true, version: true },
  });

  return {
    orderId: order.id,
    step1InstanceId: instances[0]!.id,
    step1Version: instances[0]!.version,
    step2InstanceId: instances[1]!.id,
    releaseToken: released.releasedSteps[0]?.releaseToken,
  };
}

/**
 * Der große Auftrag aus docs/09: `stepCount` Arbeitsschritte, `photoCount`
 * Nachweisfotos.
 *
 * Plan und Nachweise werden **direkt eingefügt**, nicht über die Dienste
 * angelegt. Gemessen werden soll das Lesen der Akte, nicht das Schreiben von
 * 500 Planschritten — und ein Auftrag dieser Größe entsteht in der Praxis
 * ohnehin aus einem Import, nicht aus 500 Formularen. Die Fotos landen als
 * echte Objekte in MinIO, weil der ZIP-Export sie tatsächlich liest und ein
 * fehlendes Objekt nur `MISSING` ins Manifest schreiben würde, statt Arbeit
 * zu verursachen.
 */
export async function seedLargeOrder(
  db: PrismaClient,
  fixture: ShiftFixture,
  stepCount: number,
  photoCount: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ orderId: string }> {
  const organizationId = fixture.organizationId;
  const suffix = randomUUID().slice(0, 8);

  const template = await db.productionOrder.findFirstOrThrow({
    where: { organizationId },
    select: { projectId: true, productId: true, productionPlanRevisionId: true, siteId: true },
  });

  const planRevision = await db.productionPlanRevision.findUniqueOrThrow({
    where: { id: template.productionPlanRevisionId },
    select: { productionPlanId: true },
  });

  const bigRevision = await db.productionPlanRevision.create({
    data: {
      organizationId,
      productionPlanId: planRevision.productionPlanId,
      revisionNumber: `LOAD-${suffix}`,
      status: 'RELEASED',
      createdById: fixture.projectLead.userId,
      releasedById: fixture.projectLead.userId,
      releasedAt: new Date(),
    },
  });

  await db.planStep.createMany({
    data: Array.from({ length: stepCount }, (_, index) => ({
      organizationId,
      productionPlanRevisionId: bigRevision.id,
      stepNumber: index + 1,
      title: `Schritt ${index + 1}`,
      signatureRequired: false,
    })),
  });
  const planSteps = await db.planStep.findMany({
    where: { productionPlanRevisionId: bigRevision.id },
    orderBy: { stepNumber: 'asc' },
    select: { id: true, stepNumber: true },
  });

  const order = await db.productionOrder.create({
    data: {
      organizationId,
      projectId: template.projectId,
      productId: template.productId,
      siteId: template.siteId,
      productionPlanRevisionId: bigRevision.id,
      orderNumber: `LOAD-BIG-${suffix}`,
      serialNumber: `LOAD-BIG-SN-${suffix}`,
      status: 'COMPLETED',
      createdById: fixture.productionManager.userId,
      actualStartAt: new Date(Date.now() - 86_400_000),
      actualEndAt: new Date(),
    },
  });

  await db.workStepInstance.createMany({
    data: planSteps.map((step) => ({
      organizationId,
      productionOrderId: order.id,
      planStepId: step.id,
      stepNumber: step.stepNumber,
      status: 'COMPLETED',
      startedById: fixture.devices[0]!.actor.userId,
      startedAt: new Date(Date.now() - 3_600_000),
      completedAt: new Date(),
    })),
  });
  const instances = await db.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
    select: { id: true },
  });

  const capturedById = fixture.devices[0]!.actor.userId;
  const content = Buffer.from(`load test photo ${suffix}`);
  const hash = createHash('sha256').update(content).digest('hex');

  // Objekte parallel, aber gedeckelt: MinIO ist hier nicht der Prüfgegenstand.
  const uploadQueue = Array.from({ length: photoCount }, (_, index) => index);
  const storageKeys = new Map<number, string>();
  const concurrency = 24;
  let done = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = uploadQueue.pop();
        if (index === undefined) return;
        const key = `load/${suffix}/photo-${index}.bin`;
        await putObjectBytes({ storageKey: key, body: content, mimeType: 'image/jpeg' });
        storageKeys.set(index, key);
        done += 1;
        if (done % 200 === 0) onProgress?.(done, photoCount);
      }
    }),
  );

  await db.photoEvidence.createMany({
    data: Array.from({ length: photoCount }, (_, index) => ({
      organizationId,
      workStepInstanceId: instances[index % instances.length]!.id,
      photoCategory: 'LASTTEST',
      storageKey: storageKeys.get(index)!,
      fileHashSha256: hash,
      fileSizeBytes: BigInt(content.byteLength),
      mimeType: 'image/jpeg',
      malwareScanStatus: 'CLEAN',
      uploadStatus: 'COMPLETED',
      uploadedAt: new Date(),
      capturedById,
    })),
  });

  return { orderId: order.id };
}
