import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

/**
 * ERP-/Webhook-Anbindung — docs/10 Phase 6, dort „optional für MVP".
 *
 * Delivered against a REAL HTTP server on localhost rather than a mocked
 * fetch, because everything worth testing here is at the boundary: the
 * signature a foreign system has to verify, the status codes that mean
 * retry versus give up, the headers. A mock would assert that this code
 * calls the function this code calls.
 *
 * The receiver is on 127.0.0.1, which the SSRF guard exists to refuse — so
 * these tests pass `requireHttps: false` semantics by running with
 * ALLOW_PRIVATE_WEBHOOK_TARGETS, the same switch a developer needs to point
 * a webhook at their own machine. That the guard would otherwise block it is
 * asserted too.
 */

let pgContainer: StartedPostgreSqlContainer;
let ownerClient: PrismaClient;
let receiver: Server;
let receiverPort = 0;

type Actor = { userId: string; organizationId: string };

interface ReceivedRequest {
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

let received: ReceivedRequest[] = [];
/** Status the receiver answers with next; lets a test make it fail. */
let receiverStatus = 200;

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let createWebhookSubscription: typeof import('@/domain/integrations/webhook-subscriptions').createWebhookSubscription;
let listWebhookSubscriptions: typeof import('@/domain/integrations/webhook-subscriptions').listWebhookSubscriptions;
let deactivateWebhookSubscription: typeof import('@/domain/integrations/webhook-subscriptions').deactivateWebhookSubscription;
let dispatchWebhooks: typeof import('@/domain/integrations/webhook-delivery').dispatchWebhooks;
let writeOutboxEvent: typeof import('@/lib/audit/write-outbox-event').writeOutboxEvent;
let withOrgContext: typeof import('@/lib/db/tenant-context').withOrgContext;
let verifyWebhookSignature: typeof import('@/lib/integrations/webhook-signature').verifyWebhookSignature;

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
  process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS = 'true';

  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers as never, body });
      res.writeHead(receiverStatus);
      res.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverPort = (receiver.address() as { port: number }).port;

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createWebhookSubscription, listWebhookSubscriptions, deactivateWebhookSubscription } =
    await import('@/domain/integrations/webhook-subscriptions'));
  ({ dispatchWebhooks } = await import('@/domain/integrations/webhook-delivery'));
  ({ writeOutboxEvent } = await import('@/lib/audit/write-outbox-event'));
  ({ withOrgContext } = await import('@/lib/db/tenant-context'));
  ({ verifyWebhookSignature } = await import('@/lib/integrations/webhook-signature'));

  ownerClient = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
}, 240_000);

afterAll(async () => {
  await ownerClient?.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await new Promise<void>((resolve) => receiver?.close(() => resolve()));
  await pgContainer?.stop();
});

beforeEach(() => {
  received = [];
  receiverStatus = 200;
});

async function seedOrg(name: string): Promise<Actor> {
  const seeded = await seedOrganizationRbac(ownerClient, `wh-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    { email: `ad-${name}@t.local`, displayName: 'Admin', roleCode: 'ADMIN' },
  ]);
  return { userId: userIds[`ad-${name}@t.local`]!, organizationId: seeded.organizationId };
}

async function emit(actor: Actor, eventType: string, payload: Record<string, unknown> = {}) {
  return withOrgContext(actor.organizationId, (tx) =>
    writeOutboxEvent(tx, {
      organizationId: actor.organizationId,
      aggregateType: 'production_order',
      aggregateId: randomUUID(),
      eventType,
      payload,
    }),
  );
}

const endpoint = (path = '/hook') => `http://127.0.0.1:${receiverPort}${path}`;

// ─────────────────────────────────────────────────────────────

describe('Webhook-Zustellung', () => {
  it('delivers an outbox event, signed so the receiver can verify it', async () => {
    const actor = await seedOrg('deliver');
    const subscription = await createWebhookSubscription({
      actor,
      name: 'ERP',
      url: endpoint(),
      eventTypes: ['work_step.completed'],
    });

    await emit(actor, 'work_step.completed', { orderNumber: 'AUF-1' });
    const result = await dispatchWebhooks(actor);

    expect(result).toMatchObject({ enqueued: 1, delivered: 1, failed: 0 });
    expect(received).toHaveLength(1);

    const request = received[0]!;
    const signature = request.headers['x-proquado-signature']!;
    const timestamp = request.headers['x-proquado-timestamp']!;
    // The point of the whole exercise: a foreign system holding the secret
    // can prove this payload came from us and was not altered.
    expect(verifyWebhookSignature(subscription.secret, timestamp, request.body, signature)).toBe(
      true,
    );
    expect(verifyWebhookSignature('falsches-geheimnis', timestamp, request.body, signature)).toBe(
      false,
    );

    const sent = JSON.parse(request.body);
    expect(sent).toMatchObject({
      eventType: 'work_step.completed',
      payload: { orderNumber: 'AUF-1' },
    });
    expect(request.headers['x-proquado-event']).toBe('work_step.completed');
  }, 240_000);

  it('starts at the end of the stream, not at the beginning of history', async () => {
    const actor = await seedOrg('cursor-start');
    // Events that happened BEFORE anybody registered an endpoint.
    await emit(actor, 'work_step.completed');
    await emit(actor, 'work_step.completed');

    await createWebhookSubscription({
      actor,
      name: 'ERP',
      url: endpoint(),
      eventTypes: [],
    });
    await emit(actor, 'work_step.completed');

    const result = await dispatchWebhooks(actor);
    // Only the one that happened after registration. A new endpoint being
    // hit with the organization's entire history is a surprise for the
    // receiver and a stampede for us.
    expect(result.delivered).toBe(1);
  }, 240_000);

  it('sends only the subscribed event types, and does not stall on the others', async () => {
    const actor = await seedOrg('filter');
    await createWebhookSubscription({
      actor,
      name: 'ERP',
      url: endpoint(),
      eventTypes: ['production_order.completed'],
    });

    await emit(actor, 'work_step.started');
    await emit(actor, 'work_step.completed');
    await emit(actor, 'production_order.completed', { orderNumber: 'AUF-2' });

    const result = await dispatchWebhooks(actor);
    expect(result.delivered).toBe(1);
    expect(JSON.parse(received[0]!.body).eventType).toBe('production_order.completed');

    // The cursor moved past the filtered-out events too — otherwise a
    // narrow subscription re-scans them forever and never reaches its own
    // later events (the same rule as the device sync).
    const [row] = await ownerClient.webhookSubscription.findMany({
      where: { organizationId: actor.organizationId },
    });
    const latest = await ownerClient.outboxEvent.findFirst({
      where: { organizationId: actor.organizationId },
      orderBy: { sequence: 'desc' },
    });
    expect(row!.cursor).toBe(latest!.sequence);
  }, 240_000);

  it('never sends the same event to the same endpoint twice', async () => {
    const actor = await seedOrg('idempotent');
    await createWebhookSubscription({ actor, name: 'ERP', url: endpoint(), eventTypes: [] });
    await emit(actor, 'work_step.completed');

    await dispatchWebhooks(actor);
    await dispatchWebhooks(actor);
    await dispatchWebhooks(actor);

    expect(received).toHaveLength(1);
  }, 240_000);

  it('retries a failing receiver and gives up visibly rather than silently', async () => {
    const actor = await seedOrg('retry');
    await createWebhookSubscription({ actor, name: 'ERP', url: endpoint(), eventTypes: [] });
    await emit(actor, 'work_step.completed');

    receiverStatus = 500;
    const first = await dispatchWebhooks(actor);
    expect(first).toMatchObject({ delivered: 0, failed: 0, retryScheduled: 1 });

    const [pending] = await ownerClient.webhookDelivery.findMany({
      where: { organizationId: actor.organizationId },
    });
    expect(pending!.status).toBe('PENDING');
    expect(pending!.attempts).toBe(1);
    expect(pending!.responseStatus).toBe(500);
    expect(pending!.failureReason).toBe('HTTP_500');
    // Not tried again immediately — the backoff is what stops a broken
    // receiver from being hammered.
    expect(pending!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const second = await dispatchWebhooks(actor);
    expect(second.delivered).toBe(0);
    expect(received).toHaveLength(1);

    // Exhaust the attempts by hand and confirm it ends FAILED with a reason,
    // rather than disappearing.
    await ownerClient.webhookDelivery.update({
      where: { id: pending!.id },
      data: { attempts: 5, nextAttemptAt: new Date() },
    });
    const third = await dispatchWebhooks(actor);
    expect(third.failed).toBe(1);

    const finished = await ownerClient.webhookDelivery.findUniqueOrThrow({
      where: { id: pending!.id },
    });
    expect(finished.status).toBe('FAILED');
    expect(finished.failureReason).toBe('HTTP_500');
  }, 240_000);

  it('stops sending once the subscription is deactivated', async () => {
    const actor = await seedOrg('deactivate');
    const created = await createWebhookSubscription({
      actor,
      name: 'ERP',
      url: endpoint(),
      eventTypes: [],
    });
    await emit(actor, 'work_step.completed');
    await deactivateWebhookSubscription(actor, created.id, 'ERP wird abgelöst');

    const result = await dispatchWebhooks(actor);
    expect(received).toHaveLength(0);
    expect(result.enqueued).toBe(0);

    // The subscription itself stays, so the history can still say where data
    // went while it was active.
    const listed = await listWebhookSubscriptions(actor);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.isActive).toBe(false);
  }, 240_000);

  it('never hands out the signing secret again', async () => {
    const actor = await seedOrg('secret');
    const created = await createWebhookSubscription({
      actor,
      name: 'ERP',
      url: endpoint(),
      eventTypes: [],
    });
    expect(created.secret).toHaveLength(43);

    const listed = await listWebhookSubscriptions(actor);
    // `cursor` is a BigInt, so serialise it the way the route does.
    const asJson = JSON.stringify(listed, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(asJson).not.toContain(created.secret);
    expect(listed[0]).not.toHaveProperty('secret');
  }, 240_000);

  it('does not deliver one organization’s events to another’s endpoint', async () => {
    const mine = await seedOrg('tenant-a');
    const theirs = await seedOrg('tenant-b');

    await createWebhookSubscription({
      actor: theirs,
      name: 'ERP',
      url: endpoint('/theirs'),
      eventTypes: [],
    });
    await emit(mine, 'work_step.completed', { geheim: 'nicht für den anderen Mandanten' });

    await dispatchWebhooks(theirs);
    expect(received).toHaveLength(0);
  }, 240_000);

  it('refuses an endpoint pointing into the internal network', async () => {
    const actor = await seedOrg('ssrf');
    delete process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS;
    try {
      await expect(
        createWebhookSubscription({
          actor,
          name: 'Metadaten',
          url: 'http://169.254.169.254/latest/meta-data/',
          eventTypes: [],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS = 'true';
    }
  }, 240_000);

  it('is not open to somebody without integration.manage', async () => {
    const seeded = await seedOrganizationRbac(ownerClient, 'wh-authz');
    const userIds = await seedDemoUsers(ownerClient, seeded, [
      { email: 'w-authz@t.local', displayName: 'Worker', roleCode: 'WORKER' },
    ]);
    const worker: Actor = {
      userId: userIds['w-authz@t.local']!,
      organizationId: seeded.organizationId,
    };

    await expect(
      createWebhookSubscription({ actor: worker, name: 'X', url: endpoint(), eventTypes: [] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  }, 240_000);
});
