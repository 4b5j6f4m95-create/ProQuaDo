import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Phase 3 (Online-Ausführung) against real infrastructure — real Postgres
// with real RLS and CHECK constraints, real MinIO for photo evidence, real
// domain services. Covers Abnahmeszenario A (MASTERPROMPT Kap. 22) plus the
// binding Negativtests #1, #2, #3, #6, #8 and #12 from
// docs/09_TEST_PYRAMID.md.

let pgContainer: StartedPostgreSqlContainer;
let minioContainer: StartedTestContainer;
let ownerClient: PrismaClient;

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
let listMyOrders: typeof import('@/domain/production-orders/order-queries').listMyOrders;

let startWorkStep: typeof import('@/domain/execution/start-work-step').startWorkStep;
let canStartWorkStep: typeof import('@/domain/execution/start-work-step').canStartWorkStep;
let recordChecklistResponse: typeof import('@/domain/execution/capture-evidence').recordChecklistResponse;
let recordMeasurementResult: typeof import('@/domain/execution/capture-evidence').recordMeasurementResult;
let requestPhotoUploadUrl: typeof import('@/domain/execution/photo-evidence').requestPhotoUploadUrl;
let completePhotoUpload: typeof import('@/domain/execution/photo-evidence').completePhotoUpload;
let submitWorkStepCompletion: typeof import('@/domain/execution/complete-work-step').submitWorkStepCompletion;
let getWorkStepInstance: typeof import('@/domain/execution/execution-queries').getWorkStepInstance;

const DEMO_PIN = '4711';

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
  process.env.S3_BUCKET = 'test-evidence';
  process.env.S3_ACCESS_KEY_ID = 'testuser';
  process.env.S3_SECRET_ACCESS_KEY = 'testpassword';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  // Explicit: getMalwareScanner() warns when nothing is configured, and the
  // tests are not the place to rehearse that warning (see malware-scan.ts).
  process.env.MALWARE_SCANNER = 'stub';

  const bootstrapS3 = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'testuser', secretAccessKey: 'testpassword' },
  });
  await bootstrapS3.send(new CreateBucketCommand({ Bucket: 'test-evidence' }));

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
  ({ listMyOrders } = await import('@/domain/production-orders/order-queries'));
  ({ startWorkStep, canStartWorkStep } = await import('@/domain/execution/start-work-step'));
  ({ recordChecklistResponse, recordMeasurementResult } =
    await import('@/domain/execution/capture-evidence'));
  ({ requestPhotoUploadUrl, completePhotoUpload } =
    await import('@/domain/execution/photo-evidence'));
  ({ submitWorkStepCompletion } = await import('@/domain/execution/complete-work-step'));
  ({ getWorkStepInstance } = await import('@/domain/execution/execution-queries'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
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
  worker: { userId: string; organizationId: string };
  otherWorker: { userId: string; organizationId: string };
  projectLead: { userId: string; organizationId: string };
  qualityManager: { userId: string; organizationId: string };
  productionManager: { userId: string; organizationId: string };
  orderId: string;
  step1InstanceId: string;
  step2InstanceId: string;
  checklistItemId: string;
  photoRequirementId: string;
  inspectionCharacteristicId: string;
  releaseTokens: Record<string, string>;
}

/**
 * Builds the whole Abnahmeszenario A precondition: a released two-step plan
 * (step 1 demands checklist + photo + measurement, step 2 demands nothing),
 * a released order against it, and a worker assigned to that order.
 */
async function seedScenario(
  name: string,
  options: { fourEyesOnStep1?: boolean } = {},
): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `phase3-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    {
      email: `worker-${name}@test.local`,
      displayName: 'Worker',
      roleCode: 'WORKER',
      confirmationPin: DEMO_PIN,
    },
    {
      email: `worker2-${name}@test.local`,
      displayName: 'Worker 2',
      roleCode: 'WORKER',
      confirmationPin: DEMO_PIN,
    },
    { email: `pl-${name}@test.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    { email: `qm-${name}@test.local`, displayName: 'QM', roleCode: 'QUALITY_MANAGER' },
    { email: `pm-${name}@test.local`, displayName: 'PM', roleCode: 'PRODUCTION_MANAGER' },
  ]);

  const actor = (email: string) => ({
    userId: userIds[email]!,
    organizationId: seeded.organizationId,
  });
  const worker = actor(`worker-${name}@test.local`);
  const otherWorker = actor(`worker2-${name}@test.local`);
  const projectLead = actor(`pl-${name}@test.local`);
  const qualityManager = actor(`qm-${name}@test.local`);
  const productionManager = actor(`pm-${name}@test.local`);

  const site = await ownerClient.site.create({
    data: {
      organizationId: seeded.organizationId,
      code: `SITE-${randomUUID().slice(0, 8)}`,
      name: 'Werk 1',
    },
  });
  const customer = await ownerClient.customer.create({
    data: {
      organizationId: seeded.organizationId,
      customerNumber: `CUST-${randomUUID().slice(0, 8)}`,
      name: 'Testkunde GmbH',
    },
  });
  const project = await ownerClient.project.create({
    data: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      projectNumber: `PROJ-${randomUUID().slice(0, 8)}`,
      name: 'Testprojekt',
      customerId: customer.id,
      createdById: projectLead.userId,
      status: 'ACTIVE',
    },
  });
  const product = await ownerClient.product.create({
    data: {
      organizationId: seeded.organizationId,
      projectId: project.id,
      productNumber: `PROD-${randomUUID().slice(0, 8)}`,
      name: 'Gehäuse Baugruppe A',
    },
  });

  const { revision } = await createProductionPlan({
    actor: projectLead,
    projectId: project.id,
    productId: product.id,
    planNumber: `PLAN-${randomUUID().slice(0, 8)}`,
    name: 'Montageplan',
  });

  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 1,
    title: 'Gehäusedeckel montieren',
    instruction: 'Deckel aufsetzen und mit 4 Schrauben fixieren.',
    fourEyesRequired: options.fourEyesOnStep1 ?? false,
  });
  const step2 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 2,
    title: 'Endprüfung',
    signatureRequired: true,
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
    text: 'Sichtprüfung Gehäuse',
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
    orderNumber: `AUF-${randomUUID().slice(0, 8)}`,
    serialNumber: `SN-${randomUUID().slice(0, 8)}`,
  });
  const planned = await transitionProductionOrderStatus({
    actor: productionManager,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: order.version,
  });
  const releaseResult = await releaseProductionOrder({
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

  const instances = await ownerClient.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
  });

  return {
    organizationId: seeded.organizationId,
    worker,
    otherWorker,
    projectLead,
    qualityManager,
    productionManager,
    orderId: order.id,
    step1InstanceId: instances[0]!.id,
    step2InstanceId: instances[1]!.id,
    checklistItemId: checklistItem.id,
    photoRequirementId: photoRequirement.id,
    inspectionCharacteristicId: characteristic.id,
    releaseTokens: Object.fromEntries(
      releaseResult.releasedSteps.map((s) => [s.workStepInstanceId, s.releaseToken]),
    ),
  };
}

async function uploadPhoto(
  fx: Fixtures,
  workStepInstanceId: string,
  content = `Foto ${randomUUID()}`,
) {
  const buffer = Buffer.from(content);
  const hash = createHash('sha256').update(buffer).digest('hex');

  const { uploadUrl, photoEvidenceId } = await requestPhotoUploadUrl({
    actor: fx.worker,
    workStepInstanceId,
    mimeType: 'image/jpeg',
    photoRequirementId: fx.photoRequirementId,
  });
  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  expect(putResponse.status).toBe(200);

  return completePhotoUpload({
    actor: fx.worker,
    photoEvidenceId,
    expectedHashSha256: hash,
  });
}

/** Everything step 1 demands, so a completion attempt should succeed. */
async function fulfilStep1(fx: Fixtures) {
  await recordChecklistResponse({
    actor: fx.worker,
    workStepInstanceId: fx.step1InstanceId,
    checklistItemId: fx.checklistItemId,
    response: 'OK',
  });
  await uploadPhoto(fx, fx.step1InstanceId);
  await recordMeasurementResult({
    actor: fx.worker,
    workStepInstanceId: fx.step1InstanceId,
    inspectionCharacteristicId: fx.inspectionCharacteristicId,
    measuredValue: '2.1',
  });
}

describe('Abnahmeszenario A — regulärer Onlinefluss', () => {
  it('releases step 1 only, executes it, and releases step 2 only after server validation', async () => {
    const fx = await seedScenario('happy');

    // After order release: entry step READY, successor LOCKED.
    const afterRelease = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(afterRelease.map((i) => i.status)).toEqual(['READY', 'LOCKED']);

    // Exactly one release record exists — for step 1.
    const releases = await ownerClient.workStepRelease.findMany({
      where: { organizationId: fx.organizationId },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]!.workStepInstanceId).toBe(fx.step1InstanceId);

    const myOrders = await listMyOrders(fx.worker);
    expect(myOrders).toHaveLength(1);
    expect(myOrders[0]!.currentStep?.id).toBe(fx.step1InstanceId);

    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    const order = await ownerClient.productionOrder.findUniqueOrThrow({
      where: { id: fx.orderId },
    });
    expect(order.status).toBe('IN_PROGRESS');

    await fulfilStep1(fx);

    const stepView = await getWorkStepInstance(fx.worker, fx.step1InstanceId);
    expect(stepView.evaluation.satisfied).toBe(false); // confirmation still missing
    expect(stepView.evaluation.gaps.map((g) => g.code)).toEqual(['CONFIRMATION_MISSING']);

    const result = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });

    expect(result.result).toBe('COMPLETED');
    expect(result.nextStepInstanceIds).toEqual([fx.step2InstanceId]);

    const afterCompletion = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(afterCompletion.map((i) => i.status)).toEqual(['COMPLETED', 'READY']);
    expect(afterCompletion[0]!.completedAt).not.toBeNull();

    // Step 2 got its OWN release record — not a re-use of step 1's.
    const releasesAfter = await ownerClient.workStepRelease.findMany({
      where: { organizationId: fx.organizationId },
    });
    expect(releasesAfter).toHaveLength(2);
    expect(new Set(releasesAfter.map((r) => r.tokenNonce)).size).toBe(2);

    // The audit trail carries the whole story, including which plan
    // revision the execution was documented against.
    const auditTypes = await ownerClient.auditEvent.findMany({
      where: { organizationId: fx.organizationId, resourceId: fx.step1InstanceId },
      orderBy: { serverTimestamp: 'asc' },
      select: { eventType: true },
    });
    expect(auditTypes.map((a) => a.eventType)).toEqual([
      'work_step.released',
      'work_step.started',
      'work_step.completion_submitted',
      'work_step.completed',
    ]);

    // Finishing the last step completes the order.
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step2InstanceId });
    const secondResult = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step2InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });
    expect(secondResult.result).toBe('COMPLETED');

    const finishedOrder = await ownerClient.productionOrder.findUniqueOrThrow({
      where: { id: fx.orderId },
    });
    expect(finishedOrder.status).toBe('COMPLETED');
    expect(finishedOrder.actualEndAt).not.toBeNull();
  }, 180_000);
});

describe('Negativtest #1 — Folgeschritt bleibt gesperrt', () => {
  it('refuses to start step 2 before step 1 was validated by the server', async () => {
    const fx = await seedScenario('locked-successor');

    await expect(
      startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step2InstanceId }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });

    const decision = await canStartWorkStep(fx.worker, fx.step2InstanceId);
    expect(decision).toMatchObject({ allowed: false, reason: 'WORK_STEP_NOT_READY' });

    // Even with step 1 fully worked on but NOT yet submitted, step 2 stays
    // locked — evidence is not completion.
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfilStep1(fx);

    await expect(
      startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step2InstanceId }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });

    const step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('LOCKED');
  }, 180_000);
});

describe('Negativtest #2 — gefälschte Freigabe wird abgewiesen', () => {
  it('rejects a forged token, and a valid token of another step', async () => {
    const fx = await seedScenario('forged-token');
    const step1Token = fx.releaseTokens[fx.step1InstanceId]!;

    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        releaseToken: `${step1Token}tampered`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TOKEN' });

    // Step 1's token cannot be presented for step 2 — and step 2 is not
    // even READY, so the guard chain stops before token verification.
    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step2InstanceId,
        releaseToken: step1Token,
      }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });

    // The genuine token for the genuine step still works.
    const started = await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: step1Token,
    });
    expect(started.status).toBe('IN_PROGRESS');

    // A revoked release cannot be used afterwards.
    await ownerClient.workStepRelease.updateMany({
      where: { workStepInstanceId: fx.step2InstanceId },
      data: { isValid: false },
    });
    await expect(
      startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step2InstanceId }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });
  }, 180_000);
});

describe('Negativtest #3 — doppelte Abschlussmeldung', () => {
  it('completes exactly once and writes exactly one completion audit event', async () => {
    const fx = await seedScenario('idempotency');
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfilStep1(fx);

    const idempotencyKey = randomUUID();
    const first = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey,
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });
    const second = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey,
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });

    expect(first.result).toBe('COMPLETED');
    expect(second.result).toBe('DUPLICATE');
    expect(second.submissionId).toBe(first.submissionId);
    expect(second.workStepStatus).toBe('COMPLETED');

    const submissions = await ownerClient.completionSubmission.findMany({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(submissions).toHaveLength(1);

    const completedEvents = await ownerClient.auditEvent.findMany({
      where: { resourceId: fx.step1InstanceId, eventType: 'work_step.completed' },
    });
    expect(completedEvents).toHaveLength(1);

    const confirmations = await ownerClient.stepConfirmation.findMany({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(confirmations).toHaveLength(1);
  }, 180_000);
});

describe('Negativtest #6 — fehlender Pflichtnachweis', () => {
  it('rejects the completion, keeps the successor locked, and records the reasons', async () => {
    const fx = await seedScenario('missing-evidence');
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });

    // Checklist and measurement done, photo deliberately missing.
    await recordChecklistResponse({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      checklistItemId: fx.checklistItemId,
      response: 'OK',
    });
    await recordMeasurementResult({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      inspectionCharacteristicId: fx.inspectionCharacteristicId,
      measuredValue: '2.0',
    });

    const result = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });

    expect(result.result).toBe('REJECTED');
    expect(result.rejectionReasons.map((r) => r.code)).toEqual(['PHOTO_REQUIREMENT_UNMET']);
    expect(result.nextStepInstanceIds).toEqual([]);

    const [step1, step2] = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(step1!.status).toBe('COMPLETION_REJECTED');
    expect(step2!.status).toBe('LOCKED');

    const submission = await ownerClient.completionSubmission.findFirstOrThrow({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(submission.status).toBe('REJECTED');
    expect(submission.validationStatus).toBe('MISSING_REQUIRED_EVIDENCE');
  }, 180_000);

  it('does not count a photo whose upload was never completed', async () => {
    const fx = await seedScenario('pending-photo');
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
      inspectionCharacteristicId: fx.inspectionCharacteristicId,
      measuredValue: '2.0',
    });

    // Upload URL requested (row exists, PENDING) but nothing ever uploaded.
    await requestPhotoUploadUrl({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      mimeType: 'image/jpeg',
      photoRequirementId: fx.photoRequirementId,
    });

    const result = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });
    expect(result.result).toBe('REJECTED');
    expect(result.rejectionReasons.map((r) => r.code)).toEqual(['PHOTO_REQUIREMENT_UNMET']);
  }, 180_000);

  // Negativtest #7 for photo evidence: a mismatching hash is refused and
  // the evidence is marked FAILED rather than silently accepted.
  it('rejects a photo whose declared hash does not match the uploaded bytes', async () => {
    const fx = await seedScenario('photo-hash');
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });

    const { uploadUrl, photoEvidenceId } = await requestPhotoUploadUrl({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      mimeType: 'image/jpeg',
      photoRequirementId: fx.photoRequirementId,
    });
    await fetch(uploadUrl, { method: 'PUT', body: Buffer.from('echte Bytes') });

    await expect(
      completePhotoUpload({
        actor: fx.worker,
        photoEvidenceId,
        expectedHashSha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/Hash/);

    const evidence = await ownerClient.photoEvidence.findUniqueOrThrow({
      where: { id: photoEvidenceId },
    });
    expect(evidence.uploadStatus).toBe('FAILED');
  }, 180_000);
});

describe('Negativtest #8 — Messwert außerhalb Toleranz', () => {
  it('rejects the completion with MEASUREMENT_OUT_OF_TOLERANCE', async () => {
    const fx = await seedScenario('out-of-tolerance');
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await recordChecklistResponse({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      checklistItemId: fx.checklistItemId,
      response: 'OK',
    });
    await uploadPhoto(fx, fx.step1InstanceId);

    const measurement = await recordMeasurementResult({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      inspectionCharacteristicId: fx.inspectionCharacteristicId,
      measuredValue: '2.4', // tolerance is 1.8 – 2.2
    });
    expect(measurement.isWithinTolerance).toBe(false);
    // Limits are copied onto the result so the verdict stays reproducible.
    expect(measurement.lowerLimit?.toString()).toBe('1.8');
    expect(measurement.upperLimit?.toString()).toBe('2.2');

    const result = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });
    expect(result.result).toBe('REJECTED');
    expect(result.rejectionReasons.map((r) => r.code)).toEqual(['MEASUREMENT_OUT_OF_TOLERANCE']);

    const submission = await ownerClient.completionSubmission.findFirstOrThrow({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(submission.validationStatus).toBe('MEASUREMENT_OUT_OF_TOLERANCE');
  }, 180_000);

  it('the database itself refuses a measurement that lies about its tolerance verdict', async () => {
    const fx = await seedScenario('tolerance-check');

    // Written with the schema-owning role, which bypasses RLS — the CHECK
    // constraint still holds, which is the point: no privileged code path
    // can store a false verdict.
    await expect(
      ownerClient.measurementResult.create({
        data: {
          organizationId: fx.organizationId,
          workStepInstanceId: fx.step1InstanceId,
          inspectionCharacteristicId: fx.inspectionCharacteristicId,
          measuredValue: '9.9',
          lowerLimit: '1.8',
          upperLimit: '2.2',
          isWithinTolerance: true, // a lie
          measuredById: fx.worker.userId,
          measuredAt: new Date(),
        },
      }),
    ).rejects.toThrow(/measurement_results_tolerance_verdict_consistent|constraint/i);
  }, 180_000);
});

describe('Negativtest #12 — Mandantengrenze', () => {
  it('hides a work step of another organization even when its id is known', async () => {
    const [fxA, fxB] = await Promise.all([seedScenario('tenant-a'), seedScenario('tenant-b')]);

    await expect(getWorkStepInstance(fxA.worker, fxB.step1InstanceId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      startWorkStep({ actor: fxA.worker, workStepInstanceId: fxB.step1InstanceId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }, 240_000);
});

describe('Zuweisung und Bestätigung', () => {
  it('refuses execution by a worker who is not assigned to the order', async () => {
    const fx = await seedScenario('unassigned');

    await expect(
      startWorkStep({ actor: fx.otherWorker, workStepInstanceId: fx.step1InstanceId }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // …and the order does not show up in their "Meine Aufträge" either.
    expect(await listMyOrders(fx.otherWorker)).toEqual([]);
  }, 180_000);

  it('refuses a completion confirmed with the wrong PIN', async () => {
    const fx = await seedScenario('wrong-pin');
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfilStep1(fx);

    await expect(
      submitWorkStepCompletion({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        idempotencyKey: randomUUID(),
        confirmation: { signatureMethod: 'PIN', pin: '0000' },
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_FAILED' });

    const step = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step1InstanceId },
    });
    expect(step.status).toBe('IN_PROGRESS');
    expect(
      await ownerClient.completionSubmission.count({
        where: { workStepInstanceId: fx.step1InstanceId },
      }),
    ).toBe(0);
  }, 180_000);

  it('refuses to record evidence against a step that is not in progress', async () => {
    const fx = await seedScenario('evidence-guard');

    await expect(
      recordChecklistResponse({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId, // still READY
        checklistItemId: fx.checklistItemId,
        response: 'OK',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  }, 180_000);
});

describe('Vier-Augen-Pflicht (Vorbereitung Phase 4)', () => {
  it('holds a four-eyes step at AWAITING_SECOND_APPROVAL and keeps the successor locked', async () => {
    const fx = await seedScenario('four-eyes', { fourEyesOnStep1: true });
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step1InstanceId });
    await fulfilStep1(fx);

    const result = await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: DEMO_PIN },
    });

    expect(result.result).toBe('AWAITING_SECOND_APPROVAL');
    expect(result.nextStepInstanceIds).toEqual([]);

    const [step1, step2] = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(step1!.status).toBe('AWAITING_SECOND_APPROVAL');
    expect(step2!.status).toBe('LOCKED');

    const approval = await ownerClient.secondApproval.findFirstOrThrow({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(approval.executorId).toBe(fx.worker.userId);
    expect(approval.reviewerStatus).toBe('PENDING');
  }, 180_000);

  it('the database refuses a second approval whose reviewer is the executor (Negativtest #9)', async () => {
    const fx = await seedScenario('same-person-review', { fourEyesOnStep1: true });

    await expect(
      ownerClient.secondApproval.create({
        data: {
          organizationId: fx.organizationId,
          workStepInstanceId: fx.step1InstanceId,
          executorId: fx.worker.userId,
          reviewerId: fx.worker.userId,
          reviewerStatus: 'APPROVED',
        },
      }),
    ).rejects.toThrow(/second_approvals_executor_differs_from_reviewer|constraint/i);
  }, 180_000);
});
