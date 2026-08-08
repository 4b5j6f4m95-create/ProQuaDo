import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

// This suite spins up a REAL PostgreSQL (Testcontainers), applies the REAL
// migrations (including RLS policies and the proquado_app role — see
// prisma/migrations/20260808151300_rls_and_audit_hardening and
// 20260808151400_login_resolution_function), and exercises the actual
// application code paths. Nothing here is mocked — see
// docs/09_TEST_PYRAMID.md "Ebene 3: Integrationstests".

let container: StartedPostgreSqlContainer;
let ownerClient: PrismaClient;

// These are dynamically imported in beforeAll, AFTER process.env.DATABASE_URL
// / DIRECT_DATABASE_URL point at the container — both modules read those env
// vars at module-evaluation time (Prisma Client singleton pattern, see
// src/lib/db/client.ts), so a static top-level import would bind to the
// wrong (or absent) database.
let can: typeof import('@/lib/authz/can').can;
let withOrgContext: typeof import('@/lib/db/tenant-context').withOrgContext;
let writeAuditEvent: typeof import('@/lib/audit/write-audit-event').writeAuditEvent;
let resolveLogin: typeof import('@/lib/auth/resolve-login').resolveLogin;
let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only')
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const ownerUrl = `postgresql://proquado:proquado_dev_only@${host}:${port}/proquado?schema=public`;
  const appUrl = `postgresql://proquado_app:proquado_app_dev_only@${host}:${port}/proquado?schema=public`;

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = appUrl;
  process.env.DIRECT_DATABASE_URL = ownerUrl;

  ({ can } = await import('@/lib/authz/can'));
  ({ withOrgContext } = await import('@/lib/db/tenant-context'));
  ({ writeAuditEvent } = await import('@/lib/audit/write-audit-event'));
  ({ resolveLogin } = await import('@/lib/auth/resolve-login'));
  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));

  ownerClient = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
}, 120_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await container.stop();
});

describe('RBAC: seeded roles behave per docs/04_ROLES_PERMISSIONS_MATRIX.md', () => {
  let orgAId: string;
  let workerId: string;
  let adminId: string;

  beforeAll(async () => {
    const seeded = await seedOrganizationRbac(ownerClient, 'Integration Test Org A');
    orgAId = seeded.organizationId;
    const userIds = await seedDemoUsers(ownerClient, seeded, [
      { email: 'worker@test.local', displayName: 'Worker', roleCode: 'WORKER' },
      { email: 'admin@test.local', displayName: 'Admin', roleCode: 'ADMIN' },
    ]);
    workerId = userIds['worker@test.local']!;
    adminId = userIds['admin@test.local']!;
  });

  it('worker may execute a work step', async () => {
    const decision = await can({
      userId: workerId,
      organizationId: orgAId,
      action: 'work_step.execute',
    });
    expect(decision.allowed).toBe(true);
  });

  it('worker may NOT release a document', async () => {
    const decision = await can({
      userId: workerId,
      organizationId: orgAId,
      action: 'document.release',
    });
    expect(decision).toEqual({
      allowed: false,
      reason: 'PERMISSION_DENIED',
      message: expect.stringContaining('Berechtigung'),
    });
  });

  it('admin may manage the organization', async () => {
    const decision = await can({
      userId: adminId,
      organizationId: orgAId,
      action: 'organization.manage',
    });
    expect(decision.allowed).toBe(true);
  });

  it('admin may NOT release a document (Geschäftsgrundsatz 1: no automatic fachliche Freigabe)', async () => {
    const decision = await can({
      userId: adminId,
      organizationId: orgAId,
      action: 'document.release',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });
});

describe('Tenant isolation (ADR-006, RLS): cross-organization access is denied, not leaked', () => {
  let orgAId: string;
  let orgBId: string;
  let workerFromOrgAId: string;

  beforeAll(async () => {
    const seededA = await seedOrganizationRbac(ownerClient, 'Integration Test Org Isolation A');
    orgAId = seededA.organizationId;
    const usersA = await seedDemoUsers(ownerClient, seededA, [
      { email: 'iso-worker@test.local', displayName: 'Worker', roleCode: 'WORKER' },
    ]);
    workerFromOrgAId = usersA['iso-worker@test.local']!;

    const seededB = await seedOrganizationRbac(ownerClient, 'Integration Test Org Isolation B');
    orgBId = seededB.organizationId;
  });

  it('negative test #12 analog: a user cannot act against a different organization_id', async () => {
    const decision = await can({
      userId: workerFromOrgAId,
      organizationId: orgBId,
      action: 'work_step.execute',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });

  it('withOrgContext(orgA) only sees orgA data, never orgB, via raw RLS-governed query', async () => {
    const rowsInA = await withOrgContext(
      orgAId,
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations`,
    );
    expect(rowsInA.map((r) => r.id)).toEqual([orgAId]);

    const rowsInB = await withOrgContext(
      orgBId,
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations`,
    );
    expect(rowsInB.map((r) => r.id)).toEqual([orgBId]);
  });

  it('without any org context, RLS fails closed (zero rows, not an error, not all rows)', async () => {
    const { prisma } = await import('@/lib/db/client');
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations`;
    expect(rows).toEqual([]);
  });
});

describe('Audit trail append-only (ADR-004)', () => {
  let orgId: string;

  beforeAll(async () => {
    const seeded = await seedOrganizationRbac(ownerClient, 'Integration Test Org Audit');
    orgId = seeded.organizationId;
  });

  it('writeAuditEvent() succeeds inside a transaction (app role may INSERT)', async () => {
    const eventId = await withOrgContext(orgId, (tx) =>
      writeAuditEvent(tx, {
        organizationId: orgId,
        eventType: 'test.event_written',
        resourceType: 'test',
        source: 'system',
      }),
    );
    expect(eventId.id).toBeTruthy();

    const stored = await withOrgContext(orgId, (tx) =>
      tx.auditEvent.findUniqueOrThrow({ where: { id: eventId.id } }),
    );
    expect(stored.eventType).toBe('test.event_written');
  });

  it('the application role cannot UPDATE an audit row (permission denied at the DB grant level)', async () => {
    const { id } = await withOrgContext(orgId, (tx) =>
      writeAuditEvent(tx, {
        organizationId: orgId,
        eventType: 'test.immutable',
        resourceType: 'test',
      }),
    );

    await expect(
      withOrgContext(
        orgId,
        (tx) => tx.$executeRaw`UPDATE audit_events SET event_type = 'tampered' WHERE id = ${id}`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the application role cannot DELETE an audit row', async () => {
    const { id } = await withOrgContext(orgId, (tx) =>
      writeAuditEvent(tx, {
        organizationId: orgId,
        eventType: 'test.undeletable',
        resourceType: 'test',
      }),
    );

    await expect(
      withOrgContext(orgId, (tx) => tx.$executeRaw`DELETE FROM audit_events WHERE id = ${id}`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('secret-shaped fields in event payloads are redacted before storage', async () => {
    const { id } = await withOrgContext(orgId, (tx) =>
      writeAuditEvent(tx, {
        organizationId: orgId,
        eventType: 'test.redaction',
        resourceType: 'test',
        newValues: { password: 'hunter2', pin: '1234', normalField: 'visible' },
      }),
    );

    const stored = await withOrgContext(orgId, (tx) =>
      tx.auditEvent.findUniqueOrThrow({ where: { id } }),
    );
    expect(stored.newValues).toEqual({
      password: '[REDACTED]',
      pin: '[REDACTED]',
      normalField: 'visible',
    });
  });
});

describe('Login resolution (RLS bootstrap problem, see src/lib/auth/resolve-login.ts)', () => {
  let orgId: string;
  let workerUserId: string;

  beforeAll(async () => {
    const seeded = await seedOrganizationRbac(ownerClient, 'Integration Test Org Login');
    orgId = seeded.organizationId;
    const users = await seedDemoUsers(ownerClient, seeded, [
      { email: 'linked@test.local', displayName: 'Linked', roleCode: 'WORKER' },
    ]);
    workerUserId = users['linked@test.local']!;
    // Simulate a prior successful login: link the real OIDC subject.
    await ownerClient.user.update({
      where: { id: workerUserId },
      data: { externalId: 'oidc-sub-linked-user' },
    });
  });

  it('resolves an already-linked account by external_id', async () => {
    const resolved = await resolveLogin('oidc-sub-linked-user', 'linked@test.local');
    expect(resolved).toEqual({
      userId: workerUserId,
      organizationId: orgId,
      email: 'linked@test.local',
      displayName: 'Linked',
    });
  });

  it('links a pending invite on first login and records an audit event', async () => {
    const seeded = await seedOrganizationRbac(ownerClient, 'Integration Test Org Login Invite');
    const users = await seedDemoUsers(ownerClient, seeded, [
      { email: 'invited@test.local', displayName: 'Invited', roleCode: 'WORKER' },
    ]);
    const invitedUserId = users['invited@test.local']!;

    const resolved = await resolveLogin('brand-new-oidc-sub', 'invited@test.local');
    expect(resolved?.userId).toBe(invitedUserId);

    const linkedUser = await ownerClient.user.findUniqueOrThrow({ where: { id: invitedUserId } });
    expect(linkedUser.externalId).toBe('brand-new-oidc-sub');

    const auditEvents = await withOrgContext(seeded.organizationId, (tx) =>
      tx.auditEvent.findMany({
        where: { eventType: 'user.invite_accepted', resourceId: invitedUserId },
      }),
    );
    expect(auditEvents).toHaveLength(1);
  });

  it('returns null for a completely unknown user (no leak, no crash)', async () => {
    const resolved = await resolveLogin('nobody-sub', 'nobody@test.local');
    expect(resolved).toBeNull();
  });
});
