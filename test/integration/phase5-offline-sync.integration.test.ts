import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

// Phase 5 (Offline und Synchronisation) against real infrastructure.
//
// Covers Abnahmeszenario B (Verbindungsabbruch) and C (Revisionskonflikt)
// from MASTERPROMPT.md Kap. 22, and the four negative tests docs/09 left open
// after Phase 4: #4 (Revisionskonflikt), #5 (Rechteentzug vor Sync),
// #13 (parallele Syncs auf dieselbe Entität), #14 (Serverausfall nach Upload,
// vor Quittung). #1, #2 and #3 are re-proved here on the SYNC path — they
// were proved on the online path in Phase 3, and the whole point of Phase 5
// is that the offline path is not a weaker one.

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
let bindDocumentToPlanStep: typeof import('@/domain/production-plans/plan-step-requirements').bindDocumentToPlanStep;
let submitProductionPlanForReview: typeof import('@/domain/production-plans/plan-review-workflow').submitProductionPlanForReview;
let approveProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').approveProductionPlan;
let releaseProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').releaseProductionPlan;
let createProductionOrder: typeof import('@/domain/production-orders/create-production-order').createProductionOrder;
let transitionProductionOrderStatus: typeof import('@/domain/production-orders/create-production-order').transitionProductionOrderStatus;
let releaseProductionOrder: typeof import('@/domain/production-orders/release-production-order').releaseProductionOrder;
let assignProductionOrder: typeof import('@/domain/production-orders/assign-production-order').assignProductionOrder;
let createDocument: typeof import('@/domain/documents/create-document').createDocument;
let createDocumentRevision: typeof import('@/domain/documents/create-document').createDocumentRevision;
let requestDocumentUploadUrl: typeof import('@/domain/documents/document-upload').requestDocumentUploadUrl;
let completeDocumentUpload: typeof import('@/domain/documents/document-upload').completeDocumentUpload;
let submitDocumentRevisionForReview: typeof import('@/domain/documents/document-review-workflow').submitDocumentRevisionForReview;
let approveDocumentRevision: typeof import('@/domain/documents/document-review-workflow').approveDocumentRevision;
let releaseDocumentRevision: typeof import('@/domain/documents/document-review-workflow').releaseDocumentRevision;

let registerDevice: typeof import('@/domain/sync/device-registry').registerDevice;
let revokeDevice: typeof import('@/domain/sync/device-registry').revokeDevice;
let processSyncCommands: typeof import('@/domain/sync/sync-commands').processSyncCommands;
let pullChanges: typeof import('@/domain/sync/sync-changes').pullChanges;
let checkSyncHealth: typeof import('@/domain/sync/sync-changes').checkSyncHealth;
let buildOfflineBundle: typeof import('@/domain/sync/offline-bundle').buildOfflineBundle;
let listSyncConflicts: typeof import('@/domain/sync/conflicts').listSyncConflicts;
let decideSyncConflict: typeof import('@/domain/sync/decide-conflict').decideSyncConflict;
let startWorkStep: typeof import('@/domain/execution/start-work-step').startWorkStep;
let beginChunkedPhotoUpload: typeof import('@/domain/execution/photo-upload-chunks').beginChunkedPhotoUpload;
let uploadPhotoChunk: typeof import('@/domain/execution/photo-upload-chunks').uploadPhotoChunk;
let finishChunkedPhotoUpload: typeof import('@/domain/execution/photo-upload-chunks').finishChunkedPhotoUpload;
let readUploadState: typeof import('@/domain/execution/photo-upload-chunks').readUploadState;

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
  process.env.S3_BUCKET = 'test-offline';
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
  }).send(new CreateBucketCommand({ Bucket: 'test-offline' }));

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createProductionPlan } = await import('@/domain/production-plans/create-production-plan'));
  ({ addPlanStep, addPlanStepDependency } = await import('@/domain/production-plans/plan-steps'));
  ({ addChecklistItem, bindDocumentToPlanStep } =
    await import('@/domain/production-plans/plan-step-requirements'));
  ({ submitProductionPlanForReview, approveProductionPlan, releaseProductionPlan } =
    await import('@/domain/production-plans/plan-review-workflow'));
  ({ createProductionOrder, transitionProductionOrderStatus } =
    await import('@/domain/production-orders/create-production-order'));
  ({ releaseProductionOrder } =
    await import('@/domain/production-orders/release-production-order'));
  ({ assignProductionOrder } = await import('@/domain/production-orders/assign-production-order'));
  ({ createDocument, createDocumentRevision } = await import('@/domain/documents/create-document'));
  ({ requestDocumentUploadUrl, completeDocumentUpload } =
    await import('@/domain/documents/document-upload'));
  ({ submitDocumentRevisionForReview, approveDocumentRevision, releaseDocumentRevision } =
    await import('@/domain/documents/document-review-workflow'));

  ({ registerDevice, revokeDevice } = await import('@/domain/sync/device-registry'));
  ({ processSyncCommands } = await import('@/domain/sync/sync-commands'));
  ({ pullChanges, checkSyncHealth } = await import('@/domain/sync/sync-changes'));
  ({ buildOfflineBundle } = await import('@/domain/sync/offline-bundle'));
  ({ listSyncConflicts } = await import('@/domain/sync/conflicts'));
  ({ decideSyncConflict } = await import('@/domain/sync/decide-conflict'));
  ({ startWorkStep } = await import('@/domain/execution/start-work-step'));
  ({ beginChunkedPhotoUpload, uploadPhotoChunk, finishChunkedPhotoUpload, readUploadState } =
    await import('@/domain/execution/photo-upload-chunks'));

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
  projectLead: Actor;
  qualityManager: Actor;
  productionManager: Actor;
  projectId: string;
  orderId: string;
  step1InstanceId: string;
  step2InstanceId: string;
  step1PlanStepId: string;
  checklistItemId: string;
  deviceId: string;
  documentId?: string;
  boundRevisionId?: string;
}

async function seedScenario(
  name: string,
  options: { withBoundDocument?: boolean } = {},
): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `phase5-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    { email: `w-${name}@t.local`, displayName: 'Worker', roleCode: 'WORKER', confirmationPin: PIN },
    {
      email: `pl-${name}@t.local`,
      displayName: 'PL',
      roleCode: 'PROJECT_LEAD',
      confirmationPin: PIN,
    },
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
  const projectLead = actor('pl');
  const qualityManager = actor('qm');
  const productionManager = actor('pm');

  const site = await ownerClient.site.create({
    data: { organizationId: seeded.organizationId, code: `S-${short()}`, name: 'Werk' },
  });
  const customer = await ownerClient.customer.create({
    data: { organizationId: seeded.organizationId, customerNumber: `C-${short()}`, name: 'Kunde' },
  });
  const project = await ownerClient.project.create({
    data: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      projectNumber: `P-${short()}`,
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
      productNumber: `PR-${short()}`,
      name: 'Gehäuse',
    },
  });

  let documentId: string | undefined;
  let boundRevisionId: string | undefined;
  if (options.withBoundDocument) {
    const { document, revision } = await createDocument({
      actor: projectLead,
      projectId: project.id,
      documentNumber: `P-102-${short()}`,
      title: 'Gehäusezeichnung',
      firstRevision: { title: 'Gehäusezeichnung Rev. 04' },
    });
    await uploadAndRelease(projectLead, qualityManager, revision.id, 'Rev04 Inhalt');
    documentId = document.id;
    boundRevisionId = revision.id;
  }

  const { revision: planRevision } = await createProductionPlan({
    actor: projectLead,
    projectId: project.id,
    productId: product.id,
    planNumber: `PL-${short()}`,
    name: 'Plan',
  });
  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 1,
    title: 'Gehäuse fräsen',
  });
  const step2 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 2,
    title: 'Endprüfung',
  });
  await addPlanStepDependency({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    predecessorStepId: step1.id,
    dependentStepId: step2.id,
  });
  const checklistItem = await addChecklistItem({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    itemNumber: 1,
    text: 'Sichtprüfung',
  });
  if (boundRevisionId) {
    await bindDocumentToPlanStep({
      actor: projectLead,
      productionPlanRevisionId: planRevision.id,
      planStepId: step1.id,
      documentRevisionId: boundRevisionId,
    });
  }

  await submitProductionPlanForReview({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
  });
  await approveProductionPlan({ actor: qualityManager, productionPlanRevisionId: planRevision.id });
  await releaseProductionPlan({ actor: projectLead, productionPlanRevisionId: planRevision.id });

  const order = await createProductionOrder({
    actor: productionManager,
    projectId: project.id,
    productId: product.id,
    productionPlanRevisionId: planRevision.id,
    orderNumber: `A-${short()}`,
    serialNumber: `SN-${short()}`,
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
  });

  const instances = await ownerClient.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
  });

  const device = await registerDevice({ actor: worker, deviceLabel: `Tablet ${name}` });

  return {
    organizationId: seeded.organizationId,
    worker,
    projectLead,
    qualityManager,
    productionManager,
    projectId: project.id,
    orderId: order.id,
    step1InstanceId: instances[0]!.id,
    step2InstanceId: instances[1]!.id,
    step1PlanStepId: step1.id,
    checklistItemId: checklistItem.id,
    deviceId: device.deviceId,
    ...(documentId ? { documentId } : {}),
    ...(boundRevisionId ? { boundRevisionId } : {}),
  };
}

function short(): string {
  return randomUUID().slice(0, 8);
}

async function uploadAndRelease(
  projectLead: Actor,
  qualityManager: Actor,
  documentRevisionId: string,
  content: string,
): Promise<void> {
  const buffer = Buffer.from(content);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const { uploadUrl, storageKey } = await requestDocumentUploadUrl({
    actor: projectLead,
    documentRevisionId,
    mimeType: 'text/plain',
  });
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) throw new Error(`Upload fehlgeschlagen: ${response.status}`);
  await completeDocumentUpload({
    actor: projectLead,
    documentRevisionId,
    storageKey,
    mimeType: 'text/plain',
    expectedHashSha256: hash,
  });
  await submitDocumentRevisionForReview({ actor: projectLead, documentRevisionId });
  await approveDocumentRevision({ actor: qualityManager, documentRevisionId });
  await releaseDocumentRevision({ actor: qualityManager, documentRevisionId });
}

/** The outbox as a device would send it: stable order, one idempotency key
 *  per logical command, kept across retries. */
function command(
  commandType: string,
  payload: Record<string, unknown>,
  overrides: { idempotencyKey?: string; sequenceNumber?: number; baseVersion?: number } = {},
) {
  return {
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    commandType: commandType as never,
    payload,
    clientTimestamp: new Date(),
    sequenceNumber: overrides.sequenceNumber ?? 1,
    ...(overrides.baseVersion !== undefined ? { baseVersion: overrides.baseVersion } : {}),
  };
}

// ─────────────────────────────────────────────────────────────

describe('Abnahmeszenario B — Verbindungsabbruch', () => {
  it('completes a step offline and syncs it, without the successor ever unlocking early', async () => {
    const fx = await seedScenario('scenario-b');

    // Before going offline: the bundle carries a token for the released
    // step 1 — and none for the locked step 2 (Negativtest #1 at the source).
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const steps = bundle.orders.flatMap((o) => o.steps);
    const step1 = steps.find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    const step2 = steps.find((s) => s.workStepInstanceId === fx.step2InstanceId)!;
    expect(step1.status).toBe('READY');
    expect(step1.releaseToken).toBeTruthy();
    expect(step2.status).toBe('LOCKED');
    expect(step2.releaseToken).toBeNull();

    // ... connection lost. The device works locally, then reconnects and
    // pushes the whole outbox in one batch, in creation order.
    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1 },
        ),
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 2 },
        ),
        command(
          'submit_completion',
          {
            workStepInstanceId: fx.step1InstanceId,
            confirmation: { signatureMethod: 'PIN', pin: PIN },
            usedDocumentRevisionIds: [],
          },
          { sequenceNumber: 3 },
        ),
      ],
    });

    expect(results.map((r) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(results[2]!.resultingState).toMatchObject({ result: 'COMPLETED' });

    const after = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(after[0]!.status).toBe('COMPLETED');
    // The successor unlocked only now, on the server, after validation.
    expect(after[1]!.status).toBe('READY');

    // ...and the device learns about it through the event stream.
    const changes = await pullChanges({ actor: fx.worker, deviceId: fx.deviceId });
    const released = changes.events.filter((e) => e.eventType === 'work_step.released');
    expect(released.map((e) => e.aggregateId)).toContain(fx.step2InstanceId);
  }, 180_000);

  it('keeps the successor locked while the predecessor is only locally complete', async () => {
    // Negativtest #1 on the sync path: nothing has been pushed yet, so from
    // the server's point of view step 1 was never completed at all. The
    // device may believe what it likes; the successor does not move.
    const fx = await seedScenario('neg-1');

    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;

    await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: step1.releaseToken!,
      deviceId: fx.deviceId,
    });

    const step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('LOCKED');

    // And the server refuses to start it, token or no token.
    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step2InstanceId,
        deviceId: fx.deviceId,
      }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });
  }, 180_000);

  it('replays a lost batch without applying anything twice (Negativtest #3)', async () => {
    const fx = await seedScenario('neg-3');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;

    const startKey = randomUUID();
    const completionKey = randomUUID();
    const batch = [
      command(
        'start_work_step',
        { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
        { idempotencyKey: startKey, sequenceNumber: 1 },
      ),
      command(
        'record_checklist_response',
        {
          workStepInstanceId: fx.step1InstanceId,
          checklistItemId: fx.checklistItemId,
          response: 'OK',
        },
        { sequenceNumber: 2 },
      ),
      command(
        'submit_completion',
        {
          workStepInstanceId: fx.step1InstanceId,
          confirmation: { signatureMethod: 'PIN', pin: PIN },
          usedDocumentRevisionIds: [],
        },
        { idempotencyKey: completionKey, sequenceNumber: 3 },
      ),
    ];

    const first = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: batch,
    });
    expect(first.every((r) => r.status === 'ACCEPTED')).toBe(true);

    // The response never reached the device; it sends the same batch again,
    // with the same keys.
    const replay = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: batch,
    });
    expect(replay.map((r) => r.status)).toEqual(['DUPLICATE', 'DUPLICATE', 'DUPLICATE']);

    const submissions = await ownerClient.completionSubmission.findMany({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(submissions).toHaveLength(1);

    const completedEvents = await ownerClient.auditEvent.findMany({
      where: { resourceId: fx.step1InstanceId, eventType: 'work_step.completed' },
    });
    expect(completedEvents).toHaveLength(1);
  }, 180_000);

  it('refuses a forged completion status and a foreign release token (Negativtest #2)', async () => {
    const fx = await seedScenario('neg-2');
    const other = await seedScenario('neg-2-other');

    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;

    // There is no command type that states a status at all — the schema
    // rejects the very attempt (see sync-command-types.ts).
    const forged = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command('complete_work_step' as string, {
          workStepInstanceId: fx.step1InstanceId,
          status: 'COMPLETED',
        }),
      ],
    });
    expect(forged[0]!.status).toBe('REJECTED');
    expect(forged[0]!.errors?.[0]?.detail).toMatch(/Unbekannter Kommandotyp/);

    // A token minted for another organization's step does not open this one.
    const otherBundle = await buildOfflineBundle(other.worker, other.deviceId);
    const otherToken = otherBundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === other.step1InstanceId)!.releaseToken!;

    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        releaseToken: otherToken,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TOKEN' });

    // And the genuine one still works, so the refusal above was about the
    // token and not about the step.
    const started = await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: step1.releaseToken!,
    });
    expect(started.status).toBe('IN_PROGRESS');
  }, 240_000);
});

describe('Ein Stapel, wie ein echtes Gerät ihn sendet', () => {
  /**
   * Every command carries the SAME baseVersion — the version the device knew
   * when it prepared, because while offline nothing tells it otherwise.
   *
   * Abnahmeszenario B above sends no baseVersion at all, so the optimistic
   * lock never ran there; Negativtest #13 sends one, but for a single
   * command. Neither shape is what the client produces, and in between them
   * sat a bug that made the entire offline flow impossible: the first command
   * raised the server's version, and every later command in the same batch
   * was then rejected as stale against a change it had caused itself.
   *
   * Found by running the flow in a browser. Written here so it stays found.
   */
  it('applies the whole batch although every command carries the same baseVersion', async () => {
    const fx = await seedScenario('client-shaped-batch');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    const deviceKnownVersion = step1.version;

    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1, baseVersion: deviceKnownVersion },
        ),
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 2, baseVersion: deviceKnownVersion },
        ),
        command(
          'submit_completion',
          {
            workStepInstanceId: fx.step1InstanceId,
            confirmation: { signatureMethod: 'PIN', pin: PIN },
            usedDocumentRevisionIds: [],
          },
          { sequenceNumber: 3, baseVersion: deviceKnownVersion },
        ),
      ],
    });

    expect(results.map((r) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(results[2]!.resultingState).toMatchObject({ result: 'COMPLETED' });

    // And the successor opened only now, on the server, after validation.
    const after = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(after[0]!.status).toBe('COMPLETED');
    expect(after[1]!.status).toBe('READY');
  }, 180_000);

  it('still refuses a device that is genuinely behind', async () => {
    // The relaxation is confined to versions THIS batch produced. A second
    // device holding a version from before somebody else's change must still
    // be told, or Negativtest #13 would have been traded away for the fix.
    const fx = await seedScenario('client-shaped-stale');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    const staleVersion = step1.version;

    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1, baseVersion: staleVersion },
        ),
      ],
    });

    const second = await registerDevice({ actor: fx.worker, deviceLabel: 'Zweites Tablet' });
    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: second.deviceId,
      commands: [
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 1, baseVersion: staleVersion },
        ),
      ],
    });

    expect(results[0]!.status).toBe('CONFLICT');
    expect(results[0]!.conflictType).toBe('ENTITY_VERSION_CONFLICT');
  }, 180_000);
});

describe('Abnahmeszenario C — Revisionskonflikt (Negativtest #4)', () => {
  it('blocks the step, preserves the old revision, and lets a responsible person decide', async () => {
    const fx = await seedScenario('scenario-c', { withBoundDocument: true });

    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    expect(step1.documentRevisions).toHaveLength(1);
    const usedRevisionId = step1.documentRevisions[0]!.documentRevisionId;

    // T1: the device goes offline holding Rev. 04. It starts and captures.
    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1 },
        ),
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 2 },
        ),
      ],
    });

    // T2: while it is away, the project lead releases Rev. 05.
    const rev05 = await createDocumentRevision({
      actor: fx.projectLead,
      documentId: fx.documentId!,
      title: 'Gehäusezeichnung Rev. 05',
      changeReason: 'Bohrungsdurchmesser von 8 mm auf 8,2 mm angepasst',
    });
    await uploadAndRelease(fx.projectLead, fx.qualityManager, rev05.id, 'Rev05 Inhalt');

    const oldRevision = await ownerClient.documentRevision.findUniqueOrThrow({
      where: { id: usedRevisionId },
    });
    expect(oldRevision.status).toBe('SUPERSEDED');

    // T3/T4: the device syncs its offline completion, still citing Rev. 04.
    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'submit_completion',
          {
            workStepInstanceId: fx.step1InstanceId,
            confirmation: { signatureMethod: 'PIN', pin: PIN },
            usedDocumentRevisionIds: [usedRevisionId],
          },
          { sequenceNumber: 3 },
        ),
      ],
    });

    expect(results[0]!.status).toBe('CONFLICT');
    expect(results[0]!.conflictType).toBe('REVISION_CONFLICT');

    // BLOCKED — not COMPLETED, not REJECTED (docs/06).
    const blocked = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step1InstanceId },
    });
    expect(blocked.status).toBe('BLOCKED');

    // The successor stays locked while the conflict is open.
    const successor = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(successor.status).toBe('LOCKED');

    // The history says Rev. 04 and keeps saying so.
    const submission = await ownerClient.completionSubmission.findFirstOrThrow({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(submission.usedDocumentRevisionIds).toEqual([usedRevisionId]);
    expect(submission.validationStatus).toBe('REVISION_CONFLICT');

    const conflicts = await listSyncConflicts(fx.projectLead, { status: 'OPEN' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.conflictType).toBe('REVISION_CONFLICT');
    expect(conflicts[0]!.availableDecisions).toContain('ACCEPT_AS_VALID');

    // "Weiterhin gültig": the step completes, with Rev. 04 still on record.
    const decision = await decideSyncConflict({
      actor: fx.projectLead,
      conflictId: conflicts[0]!.id,
      decision: 'ACCEPT_AS_VALID',
      reason: 'Die Änderung betrifft eine andere Baugruppe; die Ausführung bleibt gültig.',
      pin: PIN,
    });
    expect(decision.workStepStatus).toBe('COMPLETED');
    expect(decision.nextStepInstanceIds).toContain(fx.step2InstanceId);

    const afterDecision = await ownerClient.completionSubmission.findFirstOrThrow({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    // Never rewritten to Rev. 05.
    expect(afterDecision.usedDocumentRevisionIds).toEqual([usedRevisionId]);

    const recorded = await ownerClient.conflictDecision.findFirstOrThrow({
      where: { syncConflictId: conflicts[0]!.id },
    });
    expect(recorded.decisionType).toBe('ACCEPT_AS_VALID');
    expect(recorded.decidedById).toBe(fx.projectLead.userId);
    expect(recorded.reason).toContain('andere Baugruppe');
  }, 240_000);

  it('retires the execution and re-releases the step when a repeat is ordered', async () => {
    const fx = await seedScenario('scenario-c-repeat', { withBoundDocument: true });
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    const usedRevisionId = step1.documentRevisions[0]!.documentRevisionId;

    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1 },
        ),
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 2 },
        ),
      ],
    });

    const rev05 = await createDocumentRevision({
      actor: fx.projectLead,
      documentId: fx.documentId!,
      title: 'Rev. 05',
      changeReason: 'Maßänderung',
    });
    await uploadAndRelease(fx.projectLead, fx.qualityManager, rev05.id, 'Rev05');

    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'submit_completion',
          {
            workStepInstanceId: fx.step1InstanceId,
            confirmation: { signatureMethod: 'PIN', pin: PIN },
            usedDocumentRevisionIds: [usedRevisionId],
          },
          { sequenceNumber: 3 },
        ),
      ],
    });

    const conflicts = await listSyncConflicts(fx.projectLead, { status: 'OPEN' });
    await decideSyncConflict({
      actor: fx.projectLead,
      conflictId: conflicts[0]!.id,
      decision: 'REPEAT_REQUIRED',
      reason: 'Maßänderung betrifft genau dieses Merkmal.',
      pin: PIN,
    });

    const attempts = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId, planStepId: fx.step1PlanStepId },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    // The original execution is retired, not erased.
    expect(attempts[0]!.status).toBe('SUPERSEDED');
    expect(attempts[0]!.id).toBe(fx.step1InstanceId);
    expect(attempts[1]!.status).toBe('READY');
    expect(attempts[1]!.attemptNumber).toBe(2);

    // The successor is still not open — the repeat has to be done first.
    const successor = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(successor.status).toBe('LOCKED');
  }, 240_000);
});

describe('Negativtest #5 — Rechteentzug vor der Synchronisation', () => {
  it('preserves the captured work and demands a human decision instead of discarding it', async () => {
    const fx = await seedScenario('neg-5');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;

    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1 },
        ),
      ],
    });

    // The worker's role is withdrawn while they are offline.
    await ownerClient.userRole.deleteMany({ where: { userId: fx.worker.userId } });

    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 2 },
        ),
      ],
    });

    expect(results[0]!.status).toBe('CONFLICT');
    expect(results[0]!.conflictType).toBe('PERMISSION_REVOKED');

    // The data is NOT discarded: the command row keeps the payload.
    const stored = await ownerClient.syncCommand.findFirstOrThrow({
      where: { idempotencyKey: results[0]!.idempotencyKey },
    });
    expect(stored.status).toBe('CONFLICT');
    expect(stored.payload).toMatchObject({ response: 'OK' });

    const conflicts = await listSyncConflicts(fx.projectLead, { status: 'OPEN' });
    expect(conflicts[0]!.conflictType).toBe('PERMISSION_REVOKED');
    // No path that simply waves it through.
    expect(conflicts[0]!.availableDecisions).not.toContain('ACCEPT_AS_VALID');
  }, 180_000);
});

describe('Negativtest #13 — parallele Syncs auf dieselbe Entität', () => {
  it('answers ENTITY_VERSION_CONFLICT when the device is behind the server', async () => {
    const fx = await seedScenario('neg-13');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    const staleVersion = step1.version;

    // A first sync moves the step on, so the version the second device still
    // holds is now out of date.
    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: step1.releaseToken },
          { sequenceNumber: 1, baseVersion: staleVersion },
        ),
      ],
    });

    const secondDevice = await registerDevice({ actor: fx.worker, deviceLabel: 'Zweites Tablet' });
    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: secondDevice.deviceId,
      commands: [
        command(
          'record_checklist_response',
          {
            workStepInstanceId: fx.step1InstanceId,
            checklistItemId: fx.checklistItemId,
            response: 'OK',
          },
          { sequenceNumber: 1, baseVersion: staleVersion },
        ),
      ],
    });

    expect(results[0]!.status).toBe('CONFLICT');
    expect(results[0]!.conflictType).toBe('ENTITY_VERSION_CONFLICT');
    expect(results[0]!.errors?.[0]?.code).toBe('ENTITY_VERSION_CONFLICT');
  }, 180_000);
});

describe('Negativtest #14 — Serverausfall nach Upload, vor Quittung', () => {
  it('resumes from the last confirmed chunk and never duplicates one', async () => {
    const fx = await seedScenario('neg-14');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;

    await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: step1.releaseToken!,
      deviceId: fx.deviceId,
    });

    const photo = Buffer.from(randomUUID().repeat(200));
    const photoHash = createHash('sha256').update(photo).digest('hex');
    const chunkSize = 1024;
    const chunkCount = Math.ceil(photo.byteLength / chunkSize);
    expect(chunkCount).toBeGreaterThan(2);

    const opened = await beginChunkedPhotoUpload({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      mimeType: 'image/jpeg',
      totalBytes: photo.byteLength,
      chunkSizeBytes: chunkSize,
      expectedHashSha256: photoHash,
      deviceId: fx.deviceId,
    });

    const sendChunk = (index: number) => {
      const slice = photo.subarray(index * chunkSize, (index + 1) * chunkSize);
      return uploadPhotoChunk({
        actor: fx.worker,
        photoEvidenceId: opened.photoEvidenceId,
        chunkIndex: index,
        chunk: slice,
        chunkHashSha256: createHash('sha256').update(slice).digest('hex'),
        deviceId: fx.deviceId,
      });
    };

    await sendChunk(0);
    const afterSecond = await sendChunk(1);
    // Connection drops here — the device never saw this acknowledgement.
    expect(afterSecond.nextChunkIndex).toBe(2);

    // On reconnect it asks the server where it stands, and continues there.
    const state = await readUploadState(fx.worker, opened.photoEvidenceId);
    expect(state.receivedChunkIndexes).toEqual([0, 1]);
    expect(state.nextChunkIndex).toBe(2);

    // The chunk whose acknowledgement was lost is sent again: recognized,
    // not stored twice.
    const replayed = await sendChunk(1);
    expect(replayed.receivedChunkIndexes).toEqual([0, 1]);
    const chunkRows = await ownerClient.photoUploadChunk.count({
      where: { photoEvidenceId: opened.photoEvidenceId },
    });
    expect(chunkRows).toBe(2);

    for (let index = 2; index < chunkCount; index++) await sendChunk(index);

    const finished = await finishChunkedPhotoUpload({
      actor: fx.worker,
      photoEvidenceId: opened.photoEvidenceId,
      expectedHashSha256: photoHash,
      deviceId: fx.deviceId,
    });
    expect(finished.uploadStatus).toBe('COMPLETED');
    expect(finished.fileHashSha256).toBe(photoHash);
    expect(Number(finished.fileSizeBytes)).toBe(photo.byteLength);

    // Finishing again after a lost acknowledgement is a no-op, not an error.
    const again = await finishChunkedPhotoUpload({
      actor: fx.worker,
      photoEvidenceId: opened.photoEvidenceId,
      expectedHashSha256: photoHash,
    });
    expect(again.uploadStatus).toBe('COMPLETED');
  }, 180_000);

  // Negativtest #7 auf Blockebene: ein beschädigter Block wird als Block
  // abgewiesen, statt am Ende als beschädigtes Foto aufzufallen.
  it('refuses a chunk whose content does not match its declared hash', async () => {
    const fx = await seedScenario('neg-14-hash');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;
    await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: step1.releaseToken!,
    });

    const photo = Buffer.from('x'.repeat(2048));
    const opened = await beginChunkedPhotoUpload({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      mimeType: 'image/jpeg',
      totalBytes: photo.byteLength,
      chunkSizeBytes: 1024,
      expectedHashSha256: createHash('sha256').update(photo).digest('hex'),
    });

    await expect(
      uploadPhotoChunk({
        actor: fx.worker,
        photoEvidenceId: opened.photoEvidenceId,
        chunkIndex: 0,
        chunk: photo.subarray(0, 1024),
        chunkHashSha256: createHash('sha256').update('etwas anderes').digest('hex'),
      }),
    ).rejects.toMatchObject({ code: 'MISSING_OR_CORRUPT_EVIDENCE' });

    expect(
      await ownerClient.photoUploadChunk.count({
        where: { photoEvidenceId: opened.photoEvidenceId },
      }),
    ).toBe(0);
  }, 180_000);
});

describe('Gerät und Ereignisstrom', () => {
  it('stops a revoked device at the health check (docs/06 Remote-Widerruf)', async () => {
    const fx = await seedScenario('device-revoke');

    const healthy = await checkSyncHealth(fx.worker, fx.deviceId);
    expect(healthy.deviceStatus).toBe('ACTIVE');

    // An ADMIN revokes it — this org's seeded admin is not among the demo
    // users, so the revocation is done by a user granted device.manage.
    const adminRole = await ownerClient.role.findFirstOrThrow({
      where: { organizationId: fx.organizationId, code: 'ADMIN' },
    });
    await ownerClient.userRole.create({
      data: {
        organizationId: fx.organizationId,
        userId: fx.productionManager.userId,
        roleId: adminRole.id,
      },
    });

    await revokeDevice({
      actor: fx.productionManager,
      deviceId: fx.deviceId,
      reason: 'Tablet verloren gemeldet',
    });

    await expect(checkSyncHealth(fx.worker, fx.deviceId)).rejects.toMatchObject({
      code: 'DEVICE_REVOKED',
    });
    await expect(
      processSyncCommands({
        actor: fx.worker,
        deviceId: fx.deviceId,
        commands: [command('start_work_step', { workStepInstanceId: fx.step1InstanceId })],
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
  }, 180_000);

  it('delivers a gap-free, monotone event stream and never re-delivers past the cursor', async () => {
    const fx = await seedScenario('cursor');
    const bundle = await buildOfflineBundle(fx.worker, fx.deviceId);
    const step1 = bundle.orders
      .flatMap((o) => o.steps)
      .find((s) => s.workStepInstanceId === fx.step1InstanceId)!;

    const firstPage = await pullChanges({ actor: fx.worker, deviceId: fx.deviceId });
    const firstCursor = BigInt(firstPage.cursor);
    expect(firstPage.events.length).toBeGreaterThan(0);

    // Sequences are strictly increasing within a page.
    const sequences = firstPage.events.map((e) => BigInt(e.cursor));
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]! > sequences[i - 1]!).toBe(true);
    }

    // Nothing new yet.
    const empty = await pullChanges({ actor: fx.worker, deviceId: fx.deviceId });
    expect(empty.events).toHaveLength(0);
    expect(BigInt(empty.cursor)).toBe(firstCursor);

    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        command('start_work_step', {
          workStepInstanceId: fx.step1InstanceId,
          releaseToken: step1.releaseToken,
        }),
      ],
    });

    const afterStart = await pullChanges({ actor: fx.worker, deviceId: fx.deviceId });
    expect(afterStart.events.map((e) => e.eventType)).toContain('work_step.started');
    expect(BigInt(afterStart.cursor) > firstCursor).toBe(true);
  }, 180_000);

  it('does not deliver another organization’s events (Negativtest #12 on the sync path)', async () => {
    const mine = await seedScenario('tenant-mine');
    const theirs = await seedScenario('tenant-theirs');

    await processSyncCommands({
      actor: theirs.worker,
      deviceId: theirs.deviceId,
      commands: [
        command('raise_non_conformance', {
          productionOrderId: theirs.orderId,
          description: 'Fremde Abweichung',
        }),
      ],
    });

    const changes = await pullChanges({ actor: mine.worker, deviceId: mine.deviceId });
    const aggregateIds = changes.events.map((e) => e.aggregateId);
    expect(aggregateIds).not.toContain(theirs.orderId);
    expect(aggregateIds).not.toContain(theirs.step1InstanceId);

    // And a device id from the other organization is simply not found.
    await expect(checkSyncHealth(mine.worker, theirs.deviceId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  }, 240_000);
});
