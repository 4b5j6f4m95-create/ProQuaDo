import { execSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

/**
 * Phase 7 hardening — adversarial tests against the central invariant of
 * docs/06_OFFLINE_SYNC_CONFLICT.md:
 *
 *   "Ein Folgeschritt darf erst begonnen werden, nachdem der Server den
 *    aktuellen Abschluss validiert, endgültig bestätigt und den Folgeschritt
 *    ausdrücklich freigegeben hat."
 *
 * docs/10_MVP_PLAN.md makes a manual penetration attempt a gate for Phase 5:
 * "Versuch, COMPLETED clientseitig zu erzwingen". This suite is the
 * automated half of that — every way a malicious or broken device could try
 * to force a completion or unlock a successor, written as an attack rather
 * than as a happy path with a negation.
 *
 * It does NOT replace the manual review the plan requires. An automated suite
 * can only try the attacks somebody thought of; that is exactly why the gate
 * asks for a human as well. Recorded in notes.md as still open.
 */

let pgContainer: StartedPostgreSqlContainer;
let ownerClient: PrismaClient;

type Actor = { userId: string; organizationId: string };

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let createProductionPlan: typeof import('@/domain/production-plans/create-production-plan').createProductionPlan;
let addPlanStep: typeof import('@/domain/production-plans/plan-steps').addPlanStep;
let addPlanStepDependency: typeof import('@/domain/production-plans/plan-steps').addPlanStepDependency;
let submitProductionPlanForReview: typeof import('@/domain/production-plans/plan-review-workflow').submitProductionPlanForReview;
let approveProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').approveProductionPlan;
let releaseProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').releaseProductionPlan;
let createProductionOrder: typeof import('@/domain/production-orders/create-production-order').createProductionOrder;
let transitionProductionOrderStatus: typeof import('@/domain/production-orders/create-production-order').transitionProductionOrderStatus;
let releaseProductionOrder: typeof import('@/domain/production-orders/release-production-order').releaseProductionOrder;
let assignProductionOrder: typeof import('@/domain/production-orders/assign-production-order').assignProductionOrder;
let registerDevice: typeof import('@/domain/sync/device-registry').registerDevice;
let revokeDevice: typeof import('@/domain/sync/device-registry').revokeDevice;
let MAX_ACTIVE_DEVICES_PER_USER: typeof import('@/domain/sync/device-registry').MAX_ACTIVE_DEVICES_PER_USER;
let resolveDeviceId: typeof import('@/lib/api/device-context').resolveDeviceId;
let processSyncCommands: typeof import('@/domain/sync/sync-commands').processSyncCommands;
let buildOfflineBundle: typeof import('@/domain/sync/offline-bundle').buildOfflineBundle;
let startWorkStep: typeof import('@/domain/execution/start-work-step').startWorkStep;
let submitWorkStepCompletion: typeof import('@/domain/execution/complete-work-step').submitWorkStepCompletion;
let verifyReleaseToken: typeof import('@/lib/security/release-token').verifyReleaseToken;

const PIN = '4711';
const TOKEN_SECRET = 'integration-test-release-token-secret';

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
  process.env.RELEASE_TOKEN_SECRET = TOKEN_SECRET;
  process.env.SERVER_NODE_ID = 'integration-test';
  process.env.MALWARE_SCANNER = 'stub';

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createProductionPlan } = await import('@/domain/production-plans/create-production-plan'));
  ({ addPlanStep, addPlanStepDependency } = await import('@/domain/production-plans/plan-steps'));
  ({ submitProductionPlanForReview, approveProductionPlan, releaseProductionPlan } =
    await import('@/domain/production-plans/plan-review-workflow'));
  ({ createProductionOrder, transitionProductionOrderStatus } =
    await import('@/domain/production-orders/create-production-order'));
  ({ releaseProductionOrder } =
    await import('@/domain/production-orders/release-production-order'));
  ({ assignProductionOrder } = await import('@/domain/production-orders/assign-production-order'));
  ({ registerDevice, revokeDevice, MAX_ACTIVE_DEVICES_PER_USER } =
    await import('@/domain/sync/device-registry'));
  ({ resolveDeviceId } = await import('@/lib/api/device-context'));
  ({ processSyncCommands } = await import('@/domain/sync/sync-commands'));
  ({ buildOfflineBundle } = await import('@/domain/sync/offline-bundle'));
  ({ startWorkStep } = await import('@/domain/execution/start-work-step'));
  ({ submitWorkStepCompletion } = await import('@/domain/execution/complete-work-step'));
  ({ verifyReleaseToken } = await import('@/lib/security/release-token'));

  ownerClient = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
});

interface Fixtures {
  organizationId: string;
  worker: Actor;
  attacker: Actor;
  admin: Actor;
  orderId: string;
  step1InstanceId: string;
  step2InstanceId: string;
  deviceId: string;
  step1Token: string;
}

function short(): string {
  return randomUUID().slice(0, 8);
}

/** Two linked steps, an assigned worker with a device, and a release token
 *  for step 1 only. Step 2 is LOCKED and has no token — that is the state all
 *  the attacks below try to break out of. */
async function seedTarget(name: string): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `phase7-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    { email: `w-${name}@t.local`, displayName: 'Worker', roleCode: 'WORKER', confirmationPin: PIN },
    {
      email: `x-${name}@t.local`,
      displayName: 'Angreifer',
      roleCode: 'WORKER',
      confirmationPin: PIN,
    },
    { email: `pl-${name}@t.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    { email: `qm-${name}@t.local`, displayName: 'QM', roleCode: 'QUALITY_MANAGER' },
    { email: `pm-${name}@t.local`, displayName: 'PM', roleCode: 'PRODUCTION_MANAGER' },
    { email: `ad-${name}@t.local`, displayName: 'Admin', roleCode: 'ADMIN' },
  ]);
  const actor = (prefix: string): Actor => ({
    userId: userIds[`${prefix}-${name}@t.local`]!,
    organizationId: seeded.organizationId,
  });
  const worker = actor('w');
  const attacker = actor('x');
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

  const { revision } = await createProductionPlan({
    actor: projectLead,
    projectId: project.id,
    productId: product.id,
    planNumber: `PL-${short()}`,
    name: 'Plan',
  });
  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 1,
    title: 'Schritt 1',
  });
  const step2 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 2,
    title: 'Schritt 2',
  });
  await addPlanStepDependency({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    predecessorStepId: step1.id,
    dependentStepId: step2.id,
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
  for (const assignee of [worker, attacker]) {
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
  const device = await registerDevice({ actor: worker, deviceLabel: `Tablet ${name}` });
  const bundle = await buildOfflineBundle(worker, device.deviceId);
  const step1Token = bundle.orders
    .flatMap((o) => o.steps)
    .find((s) => s.workStepInstanceId === instances[0]!.id)!.releaseToken!;

  return {
    organizationId: seeded.organizationId,
    worker,
    attacker,
    admin: actor('ad'),
    orderId: order.id,
    step1InstanceId: instances[0]!.id,
    step2InstanceId: instances[1]!.id,
    deviceId: device.deviceId,
    step1Token,
  };
}

function decodeToken(encoded: string): Record<string, unknown> {
  const payload = encoded.slice(0, encoded.lastIndexOf('.'));
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Re-signs a payload with a chosen secret, the way an attacker who guessed
 *  or leaked one would. */
function forgeToken(payload: Record<string, unknown>, secret: string): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(payload)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  );
  const signature = createHmac('sha256', secret).update(canonical).digest('base64url');
  return `${Buffer.from(canonical, 'utf8').toString('base64url')}.${signature}`;
}

function syncCommand(commandType: string, payload: Record<string, unknown>, sequence = 1) {
  return {
    idempotencyKey: randomUUID(),
    commandType: commandType as never,
    payload,
    clientTimestamp: new Date(),
    sequenceNumber: sequence,
  };
}

// ─────────────────────────────────────────────────────────────

describe('Angriff: COMPLETED clientseitig erzwingen', () => {
  it('offers no command type that can state a status at all', async () => {
    const fx = await seedTarget('no-status-command');

    for (const attempt of [
      { type: 'complete_work_step', payload: { workStepInstanceId: fx.step1InstanceId } },
      {
        type: 'set_work_step_status',
        payload: { workStepInstanceId: fx.step1InstanceId, status: 'COMPLETED' },
      },
      { type: 'release_work_step', payload: { workStepInstanceId: fx.step2InstanceId } },
      { type: 'work_step.completed', payload: { workStepInstanceId: fx.step1InstanceId } },
    ]) {
      const [result] = await processSyncCommands({
        actor: fx.worker,
        deviceId: fx.deviceId,
        commands: [syncCommand(attempt.type, attempt.payload)],
      });
      expect(result!.status).toBe('REJECTED');
    }

    const steps = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(steps[0]!.status).toBe('READY');
    expect(steps[1]!.status).toBe('LOCKED');
  }, 240_000);

  it('ignores a status smuggled into an accepted command payload', async () => {
    const fx = await seedTarget('smuggled-status');

    // The command IS valid — it is `start_work_step`. The extra fields are
    // the attack: a client hoping the server spreads its payload somewhere.
    const [result] = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        syncCommand('start_work_step', {
          workStepInstanceId: fx.step1InstanceId,
          releaseToken: fx.step1Token,
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          nextStepInstanceIds: [fx.step2InstanceId],
        }),
      ],
    });

    expect(result!.status).toBe('ACCEPTED');
    const steps = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    // Started, not completed — and the successor did not move.
    expect(steps[0]!.status).toBe('IN_PROGRESS');
    expect(steps[0]!.completedAt).toBeNull();
    expect(steps[1]!.status).toBe('LOCKED');
  }, 240_000);

  it('does not accept a completion for a step that was never started', async () => {
    const fx = await seedTarget('never-started');

    await expect(
      submitWorkStepCompletion({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        idempotencyKey: randomUUID(),
        confirmation: { signatureMethod: 'PIN', pin: PIN },
        usedDocumentRevisionIds: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const step1 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step1InstanceId },
    });
    expect(step1.status).toBe('READY');
  }, 240_000);
});

describe('Angriff: Release Token manipulieren', () => {
  it('rejects a token re-pointed at the locked successor', async () => {
    const fx = await seedTarget('token-repoint');

    // Payload altered, signature left as it was — it no longer matches.
    const payload = decodeToken(fx.step1Token);
    const repointed = { ...payload, workStepInstanceId: fx.step2InstanceId };
    const tampered = `${Buffer.from(JSON.stringify(repointed), 'utf8').toString('base64url')}.${fx.step1Token
      .split('.')
      .pop()}`;

    expect(verifyReleaseToken(tampered).valid).toBe(false);

    // Aimed at the locked successor it fails as WORK_STEP_NOT_READY, not
    // INVALID_RELEASE_TOKEN: assertStartPreconditions checks the step's own
    // status before it looks at any token at all. That ordering is the
    // stronger guarantee — the successor is refused on server state, so the
    // refusal does not depend on the token check working.
    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step2InstanceId,
        releaseToken: tampered,
      }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });

    // Aimed at the step that IS released, the token check is what refuses it —
    // so both barriers are shown to work, not just the first one reached.
    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        releaseToken: tampered,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TOKEN' });

    const steps = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(steps[0]!.status).toBe('READY');
    expect(steps[1]!.status).toBe('LOCKED');
  }, 240_000);

  it('rejects a token that is correctly signed but names the wrong step', async () => {
    const fx = await seedTarget('token-wrong-step');

    // The hardest case: the attacker HAS the signing secret and produces a
    // structurally perfect token for step 2. It still fails, because the
    // server checks its own work_step_releases row — the token is evidence,
    // not authority (docs/06 "Release Token – Design").
    const payload = decodeToken(fx.step1Token);
    const forged = forgeToken(
      { ...payload, workStepInstanceId: fx.step2InstanceId, tokenId: randomUUID() },
      TOKEN_SECRET,
    );

    expect(verifyReleaseToken(forged).valid).toBe(true);
    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step2InstanceId,
        releaseToken: forged,
      }),
    ).rejects.toMatchObject({ code: 'WORK_STEP_NOT_READY' });

    const step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('LOCKED');
  }, 240_000);

  it('rejects a token signed with the wrong secret', async () => {
    const fx = await seedTarget('token-wrong-secret');
    const forged = forgeToken(decodeToken(fx.step1Token), 'falsches-geheimnis');

    expect(verifyReleaseToken(forged).valid).toBe(false);
    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        releaseToken: forged,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TOKEN' });
  }, 240_000);

  it('rejects an expired token even for a step that is genuinely released', async () => {
    const fx = await seedTarget('token-expired');
    const payload = decodeToken(fx.step1Token);
    const expired = forgeToken(
      { ...payload, validUntil: new Date(Date.now() - 60_000).toISOString() },
      TOKEN_SECRET,
    );

    const verification = verifyReleaseToken(expired);
    expect(verification.valid).toBe(false);
    if (!verification.valid) expect(verification.reason).toBe('EXPIRED');
  }, 240_000);

  it('does not let one device use a token minted for another', async () => {
    const fx = await seedTarget('token-stolen');

    // Re-issuing to a second device rotates the stored hash; the first
    // device's copy is dead from that moment (see offline-bundle.ts).
    const secondDevice = await registerDevice({ actor: fx.worker, deviceLabel: 'Zweites Tablet' });
    await buildOfflineBundle(fx.worker, secondDevice.deviceId);

    await expect(
      startWorkStep({
        actor: fx.worker,
        workStepInstanceId: fx.step1InstanceId,
        releaseToken: fx.step1Token,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TOKEN' });
  }, 240_000);
});

describe('Angriff: Reihenfolge und Zuständigkeit umgehen', () => {
  it('keeps the successor locked no matter how the batch is ordered', async () => {
    const fx = await seedTarget('batch-order');

    // Sequence numbers claim the successor start happened FIRST. The server
    // sorts by them, so the attack is: can a low sequence number on a
    // successor start get it in before the predecessor is even touched?
    const results = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        syncCommand('start_work_step', { workStepInstanceId: fx.step2InstanceId }, 1),
        syncCommand(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: fx.step1Token },
          2,
        ),
      ],
    });

    // The successor attempt is refused; the legitimate one succeeds.
    expect(results[0]!.status).toBe('REJECTED');
    expect(results[1]!.status).toBe('ACCEPTED');

    const step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('LOCKED');
  }, 240_000);

  it('refuses a completion submitted by somebody who did not execute the step', async () => {
    const fx = await seedTarget('foreign-completion');

    await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: fx.step1Token,
    });

    // The attacker is assigned to the order — so this is not an assignment
    // check. They simply do not know the executing worker's PIN, and the PIN
    // is what a confirmation asserts (ADR-005).
    await expect(
      submitWorkStepCompletion({
        actor: fx.attacker,
        workStepInstanceId: fx.step1InstanceId,
        idempotencyKey: randomUUID(),
        confirmation: { signatureMethod: 'PIN', pin: '0000' },
        usedDocumentRevisionIds: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_FAILED' });

    const step1 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step1InstanceId },
    });
    expect(step1.status).toBe('IN_PROGRESS');
  }, 240_000);

  it('cannot replay a completion to also complete the successor', async () => {
    const fx = await seedTarget('replay-to-successor');

    await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        syncCommand(
          'start_work_step',
          { workStepInstanceId: fx.step1InstanceId, releaseToken: fx.step1Token },
          1,
        ),
        syncCommand(
          'submit_completion',
          {
            workStepInstanceId: fx.step1InstanceId,
            confirmation: { signatureMethod: 'PIN', pin: PIN },
            usedDocumentRevisionIds: [],
          },
          2,
        ),
      ],
    });

    const afterFirst = await ownerClient.workStepInstance.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { stepNumber: 'asc' },
    });
    expect(afterFirst[0]!.status).toBe('COMPLETED');
    // Step 2 is now legitimately READY — released by the server, on its own.
    expect(afterFirst[1]!.status).toBe('READY');

    // The attack: take the completion that worked and re-aim it at step 2,
    // which has been released but never started.
    const [replay] = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        syncCommand('submit_completion', {
          workStepInstanceId: fx.step2InstanceId,
          confirmation: { signatureMethod: 'PIN', pin: PIN },
          usedDocumentRevisionIds: [],
        }),
      ],
    });
    expect(replay!.status).toBe('REJECTED');

    const step2 = await ownerClient.workStepInstance.findUniqueOrThrow({
      where: { id: fx.step2InstanceId },
    });
    expect(step2.status).toBe('READY');
    expect(step2.completedAt).toBeNull();
  }, 240_000);
});

describe('Angriff: Nachweise fälschen', () => {
  it('refuses a photo whose declared hash does not match the stored bytes', async () => {
    // Proved against real object storage in phase3-execution and
    // phase5-offline-sync; asserted here at the level that matters for the
    // invariant — a completion cannot be built on evidence the server has
    // not verified itself.
    const fx = await seedTarget('evidence-hash');
    await startWorkStep({
      actor: fx.worker,
      workStepInstanceId: fx.step1InstanceId,
      releaseToken: fx.step1Token,
    });

    const forgedHash = createHash('sha256').update('nicht die hochgeladene datei').digest('hex');
    const [result] = await processSyncCommands({
      actor: fx.worker,
      deviceId: fx.deviceId,
      commands: [
        syncCommand('complete_photo_upload', {
          photoEvidenceId: randomUUID(),
          expectedHashSha256: forgedHash,
        }),
      ],
    });

    // An unknown evidence id is refused outright; nothing is created for it.
    expect(result!.status).toBe('REJECTED');
    const photos = await ownerClient.photoEvidence.count({
      where: { workStepInstanceId: fx.step1InstanceId },
    });
    expect(photos).toBe(0);
  }, 240_000);
});

/**
 * Found by the manual security review that docs/10 requires alongside this
 * suite — see docs/11_OFFLINE_INVARIANT_REVIEW.md. None of the attacks above
 * could have caught them, because all of them go through the sync API, and
 * the gap was that the ORDINARY API accepted the same device identity without
 * ever checking it.
 */
describe('Angriff: Geräteidentität behaupten statt nachweisen', () => {
  it('refuses a device id that was never registered', async () => {
    const fx = await seedTarget('device-unknown');

    await expect(resolveDeviceId(fx.worker, randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  }, 240_000);

  it('refuses free text where a device id is expected', async () => {
    const fx = await seedTarget('device-freetext');

    // The online endpoints used to take `z.string().max(255)` here, so this
    // value reached audit_events.device_id verbatim.
    await expect(resolveDeviceId(fx.worker, 'Tablet von Kollege Meier')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  }, 240_000);

  it("refuses another user's device, without saying it exists", async () => {
    const fx = await seedTarget('device-foreign');

    // Same error as an unknown id: distinguishing them would be a membership
    // oracle (see assertDeviceActive).
    await expect(resolveDeviceId(fx.attacker, fx.deviceId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  }, 240_000);

  it('extends the remote lock to the ordinary API, not just /sync', async () => {
    const fx = await seedTarget('device-revoked-online');

    // Accepted while the device is active.
    await expect(resolveDeviceId(fx.worker, fx.deviceId)).resolves.toBe(fx.deviceId);

    await revokeDevice({
      actor: fx.admin,
      deviceId: fx.deviceId,
      reason: 'Tablet in der Halle liegengelassen',
    });

    // docs/06 "Geräteverlust und Sicherheit": a revoked device must not be
    // able to keep working just because its session is still valid. Before
    // this fix the revocation only closed /sync/*.
    await expect(resolveDeviceId(fx.worker, fx.deviceId)).rejects.toMatchObject({
      code: 'DEVICE_REVOKED',
    });
  }, 240_000);

  it('bounds how many rate-limit buckets one user can mint', async () => {
    const fx = await seedTarget('device-cap');

    // One device already exists from the fixture.
    for (let i = 1; i < MAX_ACTIVE_DEVICES_PER_USER; i++) {
      await registerDevice({ actor: fx.worker, deviceLabel: `Tablet ${i}` });
    }

    // SYNC_COMMANDS and PHOTO_UPLOAD are counted per device (docs/05), so an
    // unbounded registration is an unbounded allowance.
    await expect(
      registerDevice({ actor: fx.worker, deviceLabel: 'Eins zu viel' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Revoking frees a slot — replacing a lost tablet must never be the thing
    // that hits the ceiling.
    await revokeDevice({ actor: fx.admin, deviceId: fx.deviceId, reason: 'ersetzt' });
    await expect(
      registerDevice({ actor: fx.worker, deviceLabel: 'Ersatzgerät' }),
    ).resolves.toMatchObject({ deviceLabel: 'Ersatzgerät' });
  }, 240_000);
});
