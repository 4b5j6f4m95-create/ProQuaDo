import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

// Phase 4 (Qualität) against real infrastructure. Covers Abnahmeszenarien D
// (blockierende Abweichung) and E (Vier Augen) from MASTERPROMPT.md Kap. 22,
// Negativtests #9, #10 and #11 from docs/09_TEST_PYRAMID.md, plus the
// regression that a rejected completion can be corrected and resubmitted.

let pgContainer: StartedPostgreSqlContainer;
let minioContainer: StartedTestContainer;
let ownerClient: PrismaClient;

type Actor = { userId: string; organizationId: string };

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let createProductionPlan: typeof import('@/domain/production-plans/create-production-plan').createProductionPlan;
let addPlanStep: typeof import('@/domain/production-plans/plan-steps').addPlanStep;
let addPlanStepDependency: typeof import('@/domain/production-plans/plan-steps').addPlanStepDependency;
let addChecklistItem: typeof import('@/domain/production-plans/plan-step-requirements').addChecklistItem;
let addPhotoRequirement: typeof import('@/domain/production-plans/plan-step-requirements').addPhotoRequirement;
let addInspectionCharacteristic: typeof import('@/domain/production-plans/plan-step-requirements').addInspectionCharacteristic;
let submitProductionPlanForReview: typeof import('@/domain/production-plans/plan-review-workflow').submitProductionPlanForReview;
let approveProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').approveProductionPlan;
let releaseProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').releaseProductionPlan;
let createProductionOrder: typeof import('@/domain/production-orders/create-production-order').createProductionOrder;
let transitionProductionOrderStatus: typeof import('@/domain/production-orders/create-production-order').transitionProductionOrderStatus;
let releaseProductionOrder: typeof import('@/domain/production-orders/release-production-order').releaseProductionOrder;
let assignProductionOrder: typeof import('@/domain/production-orders/assign-production-order').assignProductionOrder;
let startWorkStep: typeof import('@/domain/execution/start-work-step').startWorkStep;
let recordChecklistResponse: typeof import('@/domain/execution/capture-evidence').recordChecklistResponse;
let recordMeasurementResult: typeof import('@/domain/execution/capture-evidence').recordMeasurementResult;
let requestPhotoUploadUrl: typeof import('@/domain/execution/photo-evidence').requestPhotoUploadUrl;
let completePhotoUpload: typeof import('@/domain/execution/photo-evidence').completePhotoUpload;
let submitWorkStepCompletion: typeof import('@/domain/execution/complete-work-step').submitWorkStepCompletion;
let reworkRejectedCompletion: typeof import('@/domain/execution/start-work-step').reworkRejectedCompletion;

let raiseNonConformance: typeof import('@/domain/quality/raise-non-conformance').raiseNonConformance;
let assessNonConformance: typeof import('@/domain/quality/ncr-workflow').assessNonConformance;
let containNonConformance: typeof import('@/domain/quality/ncr-workflow').containNonConformance;
let createReworkStep: typeof import('@/domain/quality/ncr-workflow').createReworkStep;
let createReinspectionStep: typeof import('@/domain/quality/ncr-workflow').createReinspectionStep;
let disposeNonConformance: typeof import('@/domain/quality/ncr-workflow').disposeNonConformance;
let applyProductionHold: typeof import('@/domain/quality/production-holds').applyProductionHold;
let releaseProductionHold: typeof import('@/domain/quality/production-holds').releaseProductionHold;
let decideSecondApproval: typeof import('@/domain/quality/second-approval').decideSecondApproval;
let createMeasuringEquipment: typeof import('@/domain/quality/measuring-equipment').createMeasuringEquipment;
let recordCalibration: typeof import('@/domain/quality/measuring-equipment').recordCalibration;
let setMeasuringEquipmentStatus: typeof import('@/domain/quality/measuring-equipment').setMeasuringEquipmentStatus;

const PIN = '4711';

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only')
    .start();

  const host = pgContainer.getHost();
  const port = pgContainer.getPort();
  const ownerUrl = `postgresql://proquado:proquado_dev_only@${host}:${port}/proquado?schema=public`;
  const appUrl = `postgresql://proquado_app:proquado_app_dev_only@${host}:${port}/proquado?schema=public`;

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = appUrl;
  process.env.DIRECT_DATABASE_URL = ownerUrl;
  process.env.RELEASE_TOKEN_SECRET = 'integration-test-release-token-secret';
  process.env.SERVER_NODE_ID = 'integration-test';

  minioContainer = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'testuser', MINIO_ROOT_PASSWORD: 'testpassword' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const minioEndpoint = `http://${minioContainer.getHost()}:${minioContainer.getMappedPort(9000)}`;
  process.env.S3_ENDPOINT = minioEndpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = 'test-quality';
  process.env.S3_ACCESS_KEY_ID = 'testuser';
  process.env.S3_SECRET_ACCESS_KEY = 'testpassword';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  // Explicit: getMalwareScanner() warns when nothing is configured, and the
  // tests are not the place to rehearse that warning (see malware-scan.ts).
  process.env.MALWARE_SCANNER = 'stub';

  await new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'testuser', secretAccessKey: 'testpassword' },
  }).send(new CreateBucketCommand({ Bucket: 'test-quality' }));

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createProductionPlan } = await import('@/domain/production-plans/create-production-plan'));
  ({ addPlanStep, addPlanStepDependency } = await import('@/domain/production-plans/plan-steps'));
  ({ addChecklistItem, addPhotoRequirement, addInspectionCharacteristic } =
    await import('@/domain/production-plans/plan-step-requirements'));
  ({ submitProductionPlanForReview, approveProductionPlan, releaseProductionPlan } =
    await import('@/domain/production-plans/plan-review-workflow'));
  ({ createProductionOrder, transitionProductionOrderStatus } =
    await import('@/domain/production-orders/create-production-order'));
  ({ releaseProductionOrder } =
    await import('@/domain/production-orders/release-production-order'));
  ({ assignProductionOrder } = await import('@/domain/production-orders/assign-production-order'));
  ({ startWorkStep, reworkRejectedCompletion } =
    await import('@/domain/execution/start-work-step'));
  ({ recordChecklistResponse, recordMeasurementResult } =
    await import('@/domain/execution/capture-evidence'));
  ({ requestPhotoUploadUrl, completePhotoUpload } =
    await import('@/domain/execution/photo-evidence'));
  ({ submitWorkStepCompletion } = await import('@/domain/execution/complete-work-step'));
  ({ raiseNonConformance } = await import('@/domain/quality/raise-non-conformance'));
  ({
    assessNonConformance,
    containNonConformance,
    createReworkStep,
    createReinspectionStep,
    disposeNonConformance,
  } = await import('@/domain/quality/ncr-workflow'));
  ({ applyProductionHold, releaseProductionHold } =
    await import('@/domain/quality/production-holds'));
  ({ decideSecondApproval } = await import('@/domain/quality/second-approval'));
  ({ createMeasuringEquipment, recordCalibration, setMeasuringEquipmentStatus } =
    await import('@/domain/quality/measuring-equipment'));

  ownerClient = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
  await minioContainer.stop();
});

interface Fixtures {
  organizationId: string;
  worker: Actor;
  inspector: Actor;
  projectLead: Actor;
  qualityManager: Actor;
  productionManager: Actor;
  orderId: string;
  step1InstanceId: string;
  step2InstanceId: string;
  checklistItemId: string;
  photoRequirementId: string;
  characteristicId: string;
}

async function seedScenario(
  name: string,
  options: { fourEyesOnStep1?: boolean; requireEquipment?: boolean } = {},
): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `phase4-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    { email: `w-${name}@t.local`, displayName: 'Worker', roleCode: 'WORKER', confirmationPin: PIN },
    {
      email: `i-${name}@t.local`,
      displayName: 'Inspector',
      roleCode: 'INSPECTOR',
      confirmationPin: PIN,
    },
    { email: `pl-${name}@t.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    {
      email: `qm-${name}@t.local`,
      displayName: 'QM',
      roleCode: 'QUALITY_MANAGER',
      confirmationPin: PIN,
    },
    { email: `pm-${name}@t.local`, displayName: 'PM', roleCode: 'PRODUCTION_MANAGER' },
  ]);
  const actor = (prefix: string): Actor => ({
    userId: userIds[`${prefix}-${name}@t.local`]!,
    organizationId: seeded.organizationId,
  });
  const worker = actor('w');
  const inspector = actor('i');
  const projectLead = actor('pl');
  const qualityManager = actor('qm');
  const productionManager = actor('pm');

  const site = await ownerClient.site.create({
    data: {
      organizationId: seeded.organizationId,
      code: `S-${randomUUID().slice(0, 8)}`,
      name: 'Werk',
    },
  });
  const customer = await ownerClient.customer.create({
    data: {
      organizationId: seeded.organizationId,
      customerNumber: `C-${randomUUID().slice(0, 8)}`,
      name: 'Kunde',
    },
  });
  const project = await ownerClient.project.create({
    data: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      projectNumber: `P-${randomUUID().slice(0, 8)}`,
      name: 'Projekt',
      customerId: customer.id,
      createdById: projectLead.userId,
      status: 'ACTIVE',
    },
  });
  const product = await ownerClient.product.create({
    data: {
      organizationId: seeded.organizationId,
      projectId: project.id,
      productNumber: `PR-${randomUUID().slice(0, 8)}`,
      name: 'Gehäuse',
    },
  });

  const { revision } = await createProductionPlan({
    actor: projectLead,
    projectId: project.id,
    productId: product.id,
    planNumber: `PL-${randomUUID().slice(0, 8)}`,
    name: 'Plan',
  });
  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 1,
    title: 'Gehäusedeckel montieren',
    fourEyesRequired: options.fourEyesOnStep1 ?? false,
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
  const photoRequirement = await addPhotoRequirement({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    planStepId: step1.id,
    category: 'TYPENSCHILD',
    minCount: 1,
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
    requiresMeasuringEquipment: options.requireEquipment ?? false,
  });

  await submitProductionPlanForReview({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
  });
  await approveProductionPlan({ actor: qualityManager, productionPlanRevisionId: revision.id });
  await releaseProductionPlan({ actor: projectLead, productionPlanRevisionId: revision.id });

  const order = await createProductionOrder({
    actor: productionManager,
    projectId: project.id,
    productId: product.id,
    productionPlanRevisionId: revision.id,
    orderNumber: `A-${randomUUID().slice(0, 8)}`,
    serialNumber: `SN-${randomUUID().slice(0, 8)}`,
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
  for (const assignee of [worker, inspector]) {
    await assignProductionOrder({
      actor: productionManager,
      productionOrderId: order.id,
      userId: assignee.userId,
    });
  }

  const instances = await ownerClient.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
  });

  return {
    organizationId: seeded.organizationId,
    worker,
    inspector,
    projectLead,
    qualityManager,
    productionManager,
    orderId: order.id,
    step1InstanceId: instances[0]!.id,
    step2InstanceId: instances[1]!.id,
    checklistItemId: checklistItem.id,
    photoRequirementId: photoRequirement.id,
    characteristicId: characteristic.id,
  };
}

async function uploadPhoto(fx: Fixtures, actor: Actor, workStepInstanceId: string) {
  const buffer = Buffer.from(`Foto ${randomUUID()}`);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const { uploadUrl, photoEvidenceId } = await requestPhotoUploadUrl({
    actor,
    workStepInstanceId,
    mimeType: 'image/jpeg',
    photoRequirementId: fx.photoRequirementId,
  });
  await fetch(uploadUrl, { method: 'PUT', body: buffer });
  await completePhotoUpload({ actor, photoEvidenceId, expectedHashSha256: hash });
}

/** Records everything step 1 demands on the given instance. */
async function fulfil(
  fx: Fixtures,
  actor: Actor,
  workStepInstanceId: string,
  measuredValue: string,
  measuringEquipmentId?: string,
) {
  await recordChecklistResponse({
    actor,
    workStepInstanceId,
    checklistItemId: fx.checklistItemId,
    response: 'OK',
  });
  await uploadPhoto(fx, actor, workStepInstanceId);
  await recordMeasurementResult({
    actor,
    workStepInstanceId,
    inspectionCharacteristicId: fx.characteristicId,
    measuredValue,
    measuringEquipmentId,
  });
}

function complete(actor: Actor, workStepInstanceId: string) {
  return submitWorkStepCompletion({
    actor,
    workStepInstanceId,
    idempotencyKey: randomUUID(),
    confirmation: { signatureMethod: 'PIN', pin: PIN },
  });
}

describe('Abnahmeszenario D — blockierende Abweichung', () => {
  it('runs the full loop: out of tolerance → NCR → Nacharbeit → Nachprüfung → Disposition → Nachfolger frei', async () => {
    const fx = await seedScenario('scenario-d');

    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfil(fx, fx.worker, fx.step1InstanceId, '2.4'); // tolerance 1.8–2.2

    const rejected = await complete(fx.worker, fx.step1InstanceId);
    expect(rejected.result).toBe('REJECTED');
    expect(rejected.rejectionReasons.map((r) => r.code)).toEqual(['MEASUREMENT_OUT_OF_TOLERANCE']);

    // The server raised the NCR itself, blocking, and froze the order.
    const ncr = await ownerClient.nonConformance.findFirstOrThrow({
      where: { productionOrderId: fx.orderId },
    });
    expect(ncr.isBlocking).toBe(true);
    expect(ncr.status).toBe('OPEN');
    expect(ncr.workStepInstanceId).toBe(fx.step1InstanceId);
    expect(ncr.ncrNumber).toMatch(/^NCR-\d{4}-\d{4}$/);

    const hold = await ownerClient.productionHold.findFirstOrThrow({
      where: { nonConformanceId: ncr.id },
    });
    expect(hold.isActive).toBe(true);

    let order = await ownerClient.productionOrder.findUniqueOrThrow({ where: { id: fx.orderId } });
    expect(order.status).toBe('QUALITY_BLOCKED');
    let step1 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step1InstanceId },
    });
    expect(step1.status).toBe('BLOCKED');

    // Negativtest #10: the successor stays locked while the NCR is open.
    // The refusal names the hold rather than the step status — docs/07
    // demands cause and next action, not just a closed door.
    await expect(
      startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step2InstanceId }),
    ).rejects.toMatchObject({ code: 'ORDER_ON_HOLD' });
    expect(
      (await ownerClient.workStepInstance.findUniqueOrThrow({ where: { id: fx.step2InstanceId } }))
        .status,
    ).toBe('LOCKED');

    // QM works the NCR.
    await assessNonConformance({
      actor: fx.qualityManager,
      nonConformanceId: ncr.id,
      assessmentNotes: 'Spaltmaß deutlich über Toleranz, Nacharbeit erforderlich.',
    });
    await containNonConformance({
      actor: fx.qualityManager,
      nonConformanceId: ncr.id,
      immediateAction: 'Bauteil gekennzeichnet und ausgeschleust.',
      rootCause: 'Anzugsmoment zu niedrig.',
    });
    const rework = await createReworkStep({
      actor: fx.qualityManager,
      nonConformanceId: ncr.id,
    });

    // The rework step is its OWN instance — the failed original is untouched.
    const reworkInstance = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: rework.workStepInstanceId },
    });
    expect(reworkInstance.stepKind).toBe('REWORK');
    expect(reworkInstance.attemptNumber).toBe(2);
    expect(reworkInstance.originWorkStepInstanceId).toBe(fx.step1InstanceId);
    expect(reworkInstance.status).toBe('READY');
    step1 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step1InstanceId },
    });
    expect(step1.status).toBe('BLOCKED'); // history preserved

    // Rework is executable despite the hold that blocks regular production.
    await startWorkStep({ actor: fx.worker, workStepInstanceId: reworkInstance.id });
    await fulfil(fx, fx.worker, reworkInstance.id, '2.0');
    const reworkDone = await complete(fx.worker, reworkInstance.id);
    expect(reworkDone.result).toBe('COMPLETED');
    // Completing rework advances the NCR, it does NOT release the successor.
    expect(reworkDone.nextStepInstanceIds).toEqual([]);
    expect(
      (await ownerClient.nonConformance.findUniqueOrThrow({ where: { id: ncr.id } })).status,
    ).toBe('REINSPECTION');

    const reinspection = await createReinspectionStep({
      actor: fx.qualityManager,
      nonConformanceId: ncr.id,
    });
    const reinspectionInstance = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: reinspection.workStepInstanceId },
    });
    expect(reinspectionInstance.stepKind).toBe('REINSPECTION');
    expect(reinspectionInstance.attemptNumber).toBe(3);

    // A worker may not perform the reinspection — that needs an inspector.
    await expect(
      startWorkStep({ actor: fx.worker, workStepInstanceId: reinspectionInstance.id }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await startWorkStep({ actor: fx.inspector, workStepInstanceId: reinspectionInstance.id });
    await fulfil(fx, fx.inspector, reinspectionInstance.id, '2.0');
    const reinspectionDone = await complete(fx.inspector, reinspectionInstance.id);
    expect(reinspectionDone.result).toBe('COMPLETED');
    expect(
      (await ownerClient.nonConformance.findUniqueOrThrow({ where: { id: ncr.id } })).status,
    ).toBe('AWAITING_DISPOSITION');

    // Still blocked until QM decides.
    let step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('LOCKED');

    await disposeNonConformance({
      actor: fx.qualityManager,
      nonConformanceId: ncr.id,
      dispositionType: 'CONCESSION',
      dispositionReason: 'Nacharbeit erfolgreich, Nachprüfung bestätigt Maßhaltigkeit.',
    });

    const closed = await ownerClient.nonConformance.findUniqueOrThrow({ where: { id: ncr.id } });
    expect(closed.status).toBe('CLOSED');
    expect(
      (await ownerClient.productionHold.findUniqueOrThrow({ where: { id: hold.id } })).isActive,
    ).toBe(false);

    order = await ownerClient.productionOrder.findUniqueOrThrow({ where: { id: fx.orderId } });
    expect(order.status).toBe('IN_PROGRESS');
    step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('READY');

    // …and only now can the regular successor be started.
    const started = await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step2InstanceId,
    });
    expect(started.status).toBe('IN_PROGRESS');
  }, 240_000);
});

describe('Negativtest #10 — offene blockierende NCR sperrt den Nachfolger', () => {
  it('keeps the successor locked even after the predecessor completed', async () => {
    const fx = await seedScenario('blocking-ncr');

    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfil(fx, fx.worker, fx.step1InstanceId, '2.0');

    // A blocking NCR raised on the ORDER (not the step) before completion.
    await raiseNonConformance({
      actor: fx.worker,
      productionOrderId: fx.orderId,
      description: 'Materialfehler an der Charge festgestellt.',
      errorCategory: 'MATERIALFEHLER',
      priority: 'MEDIUM',
    });

    // The step itself cannot even be completed while the order is held.
    await expect(complete(fx.worker, fx.step1InstanceId)).rejects.toMatchObject({
      code: 'ORDER_ON_HOLD',
    });

    const step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('LOCKED');
  }, 240_000);

  it('a manual hold blocks execution and releasing it unblocks', async () => {
    const fx = await seedScenario('manual-hold');

    const hold = await applyProductionHold({
      actor: fx.productionManager,
      scopeType: 'ORDER',
      productionOrderId: fx.orderId,
      holdReason: 'Linienstopp wegen Lieferantenprüfung',
      releaseCondition: 'Freigabe durch QM',
    });

    await expect(
      startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId }),
    ).rejects.toMatchObject({ code: 'ORDER_ON_HOLD' });

    await releaseProductionHold({
      actor: fx.qualityManager,
      productionHoldId: hold.id,
      releaseReason: 'Lieferantenprüfung abgeschlossen',
    });

    const started = await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
    });
    expect(started.status).toBe('IN_PROGRESS');
  }, 240_000);
});

describe('Abnahmeszenario E / Negativtest #9 — Vier Augen', () => {
  it('refuses self-review and completes only after an independent reviewer approves', async () => {
    const fx = await seedScenario('four-eyes', { fourEyesOnStep1: true });

    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfil(fx, fx.worker, fx.step1InstanceId, '2.0');
    const submitted = await complete(fx.worker, fx.step1InstanceId);
    expect(submitted.result).toBe('AWAITING_SECOND_APPROVAL');

    // The executor cannot approve their own work — and holds no permission
    // to decide at all.
    await expect(
      decideSecondApproval({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        decision: 'APPROVE',
        pin: PIN,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const step2Before = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2Before.status).toBe('LOCKED');

    const decided = await decideSecondApproval({
      actor: fx.inspector,
      workStepInstanceId: fx.step1InstanceId,
      decision: 'APPROVE',
      pin: PIN,
    });
    expect(decided.status).toBe('COMPLETED');
    expect(decided.nextStepInstanceIds).toEqual([fx.step2InstanceId]);

    const approval = await ownerClient.secondApproval.findFirstOrThrow({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(approval.reviewerId).toBe(fx.inspector.userId);
    expect(approval.executorId).toBe(fx.worker.userId);
    expect(approval.reviewerStatus).toBe('APPROVED');
  }, 240_000);

  it('rejects the review with a reason and keeps the execution on record', async () => {
    const fx = await seedScenario('four-eyes-reject', { fourEyesOnStep1: true });

    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfil(fx, fx.worker, fx.step1InstanceId, '2.0');
    await complete(fx.worker, fx.step1InstanceId);

    const decided = await decideSecondApproval({
      actor: fx.inspector,
      workStepInstanceId: fx.step1InstanceId,
      decision: 'REJECT',
      reason: 'Schraubenbild entspricht nicht der Zeichnung.',
      pin: PIN,
    });
    expect(decided.status).toBe('COMPLETION_REJECTED');

    // The original confirmation and measurements remain.
    expect(
      await ownerClient.stepConfirmation.count({
        where: { workStepInstanceId: fx.step1InstanceId },
      }),
    ).toBe(1);
    expect(
      await ownerClient.measurementResult.count({
        where: { workStepInstanceId: fx.step1InstanceId },
      }),
    ).toBe(1);
  }, 240_000);

  it('requires a correct PIN for the review decision', async () => {
    const fx = await seedScenario('four-eyes-pin', { fourEyesOnStep1: true });
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfil(fx, fx.worker, fx.step1InstanceId, '2.0');
    await complete(fx.worker, fx.step1InstanceId);

    await expect(
      decideSecondApproval({
        actor: fx.inspector,
        workStepInstanceId: fx.step1InstanceId,
        decision: 'APPROVE',
        pin: '0000',
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_FAILED' });
  }, 240_000);
});

describe('Negativtest #11 — abgelaufenes Prüfmittel', () => {
  it('refuses a measurement taken with uncalibrated, overdue or blocked equipment', async () => {
    const fx = await seedScenario('calibration', { requireEquipment: true });
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });

    const equipment = await createMeasuringEquipment({
      actor: fx.qualityManager,
      equipmentNumber: `PM-${randomUUID().slice(0, 6)}`,
      name: 'Messschieber',
      measurementUnit: 'mm',
    });

    // No calibration recorded at all.
    await expect(
      recordMeasurementResult({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        inspectionCharacteristicId: fx.characteristicId,
        measuredValue: '2.0',
        measuringEquipmentId: equipment.id,
      }),
    ).rejects.toMatchObject({ code: 'EQUIPMENT_CALIBRATION_EXPIRED' });

    // An expired calibration is no better.
    await recordCalibration({
      actor: fx.qualityManager,
      measuringEquipmentId: equipment.id,
      calibratedAt: new Date('2024-01-01T00:00:00Z'),
      nextCalibrationDueAt: new Date('2025-01-01T00:00:00Z'),
    });
    await expect(
      recordMeasurementResult({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        inspectionCharacteristicId: fx.characteristicId,
        measuredValue: '2.0',
        measuringEquipmentId: equipment.id,
      }),
    ).rejects.toMatchObject({ code: 'EQUIPMENT_CALIBRATION_EXPIRED' });

    // A current calibration makes it usable, and the measurement pins it.
    const validCalibration = await recordCalibration({
      actor: fx.qualityManager,
      measuringEquipmentId: equipment.id,
      calibratedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      nextCalibrationDueAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    const measurement = await recordMeasurementResult({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      inspectionCharacteristicId: fx.characteristicId,
      measuredValue: '2.0',
      measuringEquipmentId: equipment.id,
    });
    expect(measurement.calibrationId).toBe(validCalibration.id);
    expect(measurement.measuringEquipmentId).toBe(equipment.id);

    // Taking the equipment out of service blocks it again, even though the
    // calibration itself is still valid.
    await setMeasuringEquipmentStatus({
      actor: fx.qualityManager,
      measuringEquipmentId: equipment.id,
      status: 'OUT_OF_SERVICE',
    });
    await expect(
      recordMeasurementResult({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        inspectionCharacteristicId: fx.characteristicId,
        measuredValue: '2.1',
        measuringEquipmentId: equipment.id,
      }),
    ).rejects.toMatchObject({ code: 'EQUIPMENT_CALIBRATION_EXPIRED' });
  }, 240_000);

  it('demands the equipment when the characteristic requires one', async () => {
    const fx = await seedScenario('equipment-required', { requireEquipment: true });
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });

    await expect(
      recordMeasurementResult({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        inspectionCharacteristicId: fx.characteristicId,
        measuredValue: '2.0',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  }, 240_000);
});

describe('Regression — Nachbesserung nach abgelehntem Abschluss', () => {
  it('lets a rejected completion be corrected and resubmitted', async () => {
    const fx = await seedScenario('resubmit');

    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await recordChecklistResponse({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      checklistItemId: fx.checklistItemId,
      response: 'OK',
    });
    await recordMeasurementResult({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      inspectionCharacteristicId: fx.characteristicId,
      measuredValue: '2.0',
    });

    // Photo missing → rejected.
    const rejected = await complete(fx.worker, fx.step1InstanceId);
    expect(rejected.result).toBe('REJECTED');
    expect(rejected.workStepStatus).toBe('COMPLETION_REJECTED');

    // Correct it and submit again — this used to fail on the one-submission-
    // per-step unique constraint, leaving the step permanently stuck.
    await reworkRejectedCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
    });
    await uploadPhoto(fx, fx.worker, fx.step1InstanceId);
    const accepted = await complete(fx.worker, fx.step1InstanceId);

    expect(accepted.result).toBe('COMPLETED');
    expect(accepted.nextStepInstanceIds).toEqual([fx.step2InstanceId]);
    expect(
      await ownerClient.completionSubmission.count({
        where: { workStepInstanceId: fx.step1InstanceId },
      }),
    ).toBe(2);
  }, 240_000);
});
