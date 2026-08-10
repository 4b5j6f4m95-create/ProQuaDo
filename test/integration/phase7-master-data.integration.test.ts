import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Stammdaten anlegen und Menschen arbeitsfähig machen.
 *
 * Der Anlass steht in notes.md: ohne Altsystem tritt an die Stelle der
 * Datenmigration die Ersterfassung — und die ging in der Anwendung nicht.
 * Standort, Kunde, Produkt, Benutzer und Rollenzuweisung entstanden
 * ausschließlich im Seed.
 *
 * Der wichtigste Fall ist deshalb nicht „Standort anlegen klappt", sondern die
 * **Kette bis zur Arbeitsfähigkeit**: einladen → anmelden → PIN setzen →
 * bestätigen können. Jedes Glied davon war einzeln vorhanden; dass sie
 * zusammen tragen, hat bis hierher niemand geprüft.
 */

let pgContainer: StartedPostgreSqlContainer;
let ownerClient: PrismaClient;

type Actor = { userId: string; organizationId: string };

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let createSite: typeof import('@/domain/master-data/master-data').createSite;
let createCustomer: typeof import('@/domain/master-data/master-data').createCustomer;
let createProduct: typeof import('@/domain/master-data/master-data').createProduct;
let createDepartment: typeof import('@/domain/master-data/master-data').createDepartment;
let createWorkCenter: typeof import('@/domain/master-data/master-data').createWorkCenter;
let inviteUser: typeof import('@/domain/identity/user-administration').inviteUser;
let assignRole: typeof import('@/domain/identity/user-administration').assignRole;
let revokeRole: typeof import('@/domain/identity/user-administration').revokeRole;
let clearConfirmationPin: typeof import('@/domain/identity/user-administration').clearConfirmationPin;
let setConfirmationPin: typeof import('@/domain/identity/set-confirmation-pin').setConfirmationPin;
let confirmWithPin: typeof import('@/domain/identity/confirm-with-pin').confirmWithPin;
let resolveLogin: typeof import('@/lib/auth/resolve-login').resolveLogin;
let createProject: typeof import('@/domain/projects/create-project').createProject;

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
  process.env.SERVER_NODE_ID = 'integration-test';

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createSite, createCustomer, createProduct, createDepartment, createWorkCenter } =
    await import('@/domain/master-data/master-data'));
  ({ inviteUser, assignRole, revokeRole, clearConfirmationPin } =
    await import('@/domain/identity/user-administration'));
  ({ setConfirmationPin } = await import('@/domain/identity/set-confirmation-pin'));
  ({ confirmWithPin } = await import('@/domain/identity/confirm-with-pin'));
  ({ resolveLogin } = await import('@/lib/auth/resolve-login'));
  ({ createProject } = await import('@/domain/projects/create-project'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
});

interface Fixtures {
  admin: Actor;
  projectLead: Actor;
  worker: Actor;
}

async function seedFixtures(name: string): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `md-${name}`);
  const ids = await seedDemoUsers(ownerClient, seeded, [
    { email: `admin-${name}@t.local`, displayName: 'Admin', roleCode: 'ADMIN' },
    { email: `pl-${name}@t.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    {
      email: `w-${name}@t.local`,
      displayName: 'Worker',
      roleCode: 'WORKER',
      confirmationPin: '4711',
    },
  ]);
  const actor = (prefix: string): Actor => ({
    userId: ids[`${prefix}-${name}@t.local`]!,
    organizationId: seeded.organizationId,
  });
  return { admin: actor('admin'), projectLead: actor('pl'), worker: actor('w') };
}

describe('Standort und Kunde', () => {
  it('legt an, was das Projektformular braucht', async () => {
    const { admin, projectLead } = await seedFixtures('basics');

    const site = await createSite({ actor: admin, code: 'WERK-2', name: 'Werk Süd' });
    const customer = await createCustomer({
      actor: admin,
      customerNumber: 'K-1000',
      name: 'Beispiel GmbH',
    });

    expect(site.code).toBe('WERK-2');
    expect(customer.customerNumber).toBe('K-1000');

    // Der eigentliche Zweck: damit lässt sich ein Projekt anlegen. Vorher
    // wären die Auswahllisten leer gewesen.
    //
    // Angelegt wird es von der Projektleitung, nicht von der Administration:
    // ADMIN hat `project.view`, nicht `project.create`. Die Stammdaten und
    // das, was damit gebaut wird, liegen bewusst in verschiedenen Händen.
    const project = await createProject({
      actor: projectLead,
      siteId: site.id,
      customerId: customer.id,
      projectNumber: 'P-2026-1',
      name: 'Erstes echtes Projekt',
    });
    expect(project.status).toBe('DRAFT');
  });

  it('weist doppelte Kürzel und Nummern lesbar ab', async () => {
    const { admin } = await seedFixtures('dupes');
    await createSite({ actor: admin, code: 'WERK-2', name: 'Werk Süd' });
    await createCustomer({ actor: admin, customerNumber: 'K-1000', name: 'Beispiel GmbH' });

    await expect(
      createSite({ actor: admin, code: 'WERK-2', name: 'Anderer Name' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      createCustomer({ actor: admin, customerNumber: 'K-1000', name: 'Andere GmbH' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lässt einen Worker weder Standorte noch Kunden anlegen', async () => {
    const { worker } = await seedFixtures('worker-denied');
    await expect(createSite({ actor: worker, code: 'X', name: 'X' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      createCustomer({ actor: worker, customerNumber: 'X', name: 'X' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('Abteilung und Arbeitsplatz', () => {
  it('gliedert einen Standort — und derselbe Name ist an einem anderen Standort erlaubt', async () => {
    const { admin } = await seedFixtures('org-structure');
    const werkNord = await createSite({ actor: admin, code: 'N', name: 'Werk Nord' });
    const werkSued = await createSite({ actor: admin, code: 'S', name: 'Werk Süd' });

    const montageNord = await createDepartment({
      actor: admin,
      siteId: werkNord.id,
      name: 'Montage',
      code: 'MO-N',
    });
    expect(montageNord.siteId).toBe(werkNord.id);

    // Der Name gilt je Standort: in einem Mehrwerksbetrieb wäre alles andere
    // schlicht falsch.
    await expect(
      createDepartment({ actor: admin, siteId: werkSued.id, name: 'Montage', code: 'MO-S' }),
    ).resolves.toBeTruthy();

    // Am selben Standort nicht.
    await expect(
      createDepartment({ actor: admin, siteId: werkNord.id, name: 'Montage' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('hält das Kürzel organisationsweit eindeutig, lässt es aber weg', async () => {
    const { admin } = await seedFixtures('dept-code');
    const site = await createSite({ actor: admin, code: 'W', name: 'Werk' });

    await createDepartment({ actor: admin, siteId: site.id, name: 'Montage', code: 'MO' });
    await expect(
      createDepartment({ actor: admin, siteId: site.id, name: 'Prüfung', code: 'MO' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Zwei ohne Kürzel bleiben erlaubt — der Unique-Index behandelt NULL-Werte
    // als verschieden, und das ist hier die gewollte Auslegung.
    await createDepartment({ actor: admin, siteId: site.id, name: 'Lager' });
    await expect(
      createDepartment({ actor: admin, siteId: site.id, name: 'Versand' }),
    ).resolves.toBeTruthy();
  });

  it('legt Arbeitsplätze je Abteilung an, mit demselben Namen in einer anderen', async () => {
    const { admin } = await seedFixtures('work-centers');
    const site = await createSite({ actor: admin, code: 'W', name: 'Werk' });
    const montage = await createDepartment({ actor: admin, siteId: site.id, name: 'Montage' });
    const pruefung = await createDepartment({ actor: admin, siteId: site.id, name: 'Prüfung' });

    await createWorkCenter({ actor: admin, departmentId: montage.id, name: 'Platz 1' });
    await expect(
      createWorkCenter({ actor: admin, departmentId: pruefung.id, name: 'Platz 1' }),
    ).resolves.toBeTruthy();
    await expect(
      createWorkCenter({ actor: admin, departmentId: montage.id, name: 'Platz 1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('verlangt einen vorhandenen Standort beziehungsweise eine vorhandene Abteilung', async () => {
    const { admin } = await seedFixtures('structure-missing');
    const nichtVorhanden = '00000000-0000-4000-8000-000000000000';
    await expect(
      createDepartment({ actor: admin, siteId: nichtVorhanden, name: 'Montage' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createWorkCenter({ actor: admin, departmentId: nichtVorhanden, name: 'Platz 1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lässt einen Worker nichts davon anlegen', async () => {
    const { admin, worker } = await seedFixtures('structure-denied');
    const site = await createSite({ actor: admin, code: 'W', name: 'Werk' });
    await expect(
      createDepartment({ actor: worker, siteId: site.id, name: 'Montage' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('Produkt', () => {
  it('gehört der Projektleitung, nicht der Administration', async () => {
    const { admin, projectLead } = await seedFixtures('product-owner');
    const site = await createSite({ actor: admin, code: 'W1', name: 'Werk' });
    const customer = await createCustomer({ actor: admin, customerNumber: 'K1', name: 'Kunde' });
    const project = await createProject({
      actor: projectLead,
      siteId: site.id,
      customerId: customer.id,
      projectNumber: 'P-1',
      name: 'Projekt',
    });

    const product = await createProduct({
      actor: projectLead,
      projectId: project.id,
      productNumber: 'ART-1',
      name: 'Gehäuse',
    });
    expect(product.projectId).toBe(project.id);

    // ADMIN hat `customer.manage`, aber ausdrücklich nicht `product.manage`:
    // das Produkt entsteht dort, wo geplant wird.
    await expect(
      createProduct({
        actor: admin,
        projectId: project.id,
        productNumber: 'ART-2',
        name: 'Deckel',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('verlangt ein vorhandenes Projekt', async () => {
    const { projectLead } = await seedFixtures('product-noproject');
    await expect(
      createProduct({
        actor: projectLead,
        projectId: '00000000-0000-4000-8000-000000000000',
        productNumber: 'ART-1',
        name: 'Gehäuse',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Einen Menschen arbeitsfähig machen', () => {
  it('einladen → anmelden → PIN setzen → bestätigen', async () => {
    const { admin } = await seedFixtures('onboarding');

    const invited = await inviteUser({
      actor: admin,
      email: 'Neue.Person@t.local',
      displayName: 'Neue Person',
      employeeNumber: 'mn-42',
      roleCode: 'WORKER',
    });

    // Eingeladen heißt: die Zeile, die der erste Login findet — noch kein
    // verknüpftes Konto.
    expect(invited.email).toBe('neue.person@t.local');
    expect(invited.externalId).toBe('pending:neue.person@t.local');

    const employee = await ownerClient.employee.findUniqueOrThrow({
      where: { userId: invited.id },
    });
    expect(employee.employeeNumber).toBe('MN-42');

    // Der erste SSO-Login tauscht das Sentinel gegen die echte Subject-ID.
    const resolved = await resolveLogin('oidc-subject-neue-person', 'neue.person@t.local');
    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toBe(invited.id);

    const linked = await ownerClient.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(linked.externalId).toBe('oidc-subject-neue-person');

    // Angemeldet, aber noch ohne Unterschrift: nichts lässt sich bestätigen.
    const newcomer: Actor = { userId: invited.id, organizationId: admin.organizationId };
    await expect(confirmWithPin(newcomer, '4071', { purpose: 'test' })).rejects.toMatchObject({
      code: 'CONFIRMATION_FAILED',
    });

    await setConfirmationPin({ actor: newcomer, newPin: '4071' });
    await expect(confirmWithPin(newcomer, '4071', { purpose: 'test' })).resolves.toBeUndefined();
  });

  it('weist doppelte E-Mail und doppelte Personalnummer ab', async () => {
    const { admin } = await seedFixtures('invite-dupes');
    await inviteUser({
      actor: admin,
      email: 'a@t.local',
      displayName: 'A',
      employeeNumber: 'MN-1',
      roleCode: 'WORKER',
    });

    await expect(
      inviteUser({
        actor: admin,
        email: 'a@t.local',
        displayName: 'A nochmal',
        employeeNumber: 'MN-2',
        roleCode: 'WORKER',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      inviteUser({
        actor: admin,
        email: 'b@t.local',
        displayName: 'B',
        employeeNumber: 'MN-1',
        roleCode: 'WORKER',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lässt einen Worker niemanden einladen', async () => {
    const { worker } = await seedFixtures('invite-denied');
    await expect(
      inviteUser({
        actor: worker,
        email: 'x@t.local',
        displayName: 'X',
        employeeNumber: 'MN-9',
        roleCode: 'ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('Rollen', () => {
  it('weist zu, weist Dubletten ab und entzieht wieder', async () => {
    const { admin } = await seedFixtures('roles');
    const invited = await inviteUser({
      actor: admin,
      email: 'r@t.local',
      displayName: 'R',
      employeeNumber: 'MN-7',
      roleCode: 'WORKER',
    });

    await assignRole({ actor: admin, userId: invited.id, roleCode: 'INSPECTOR' });
    expect(await ownerClient.userRole.count({ where: { userId: invited.id } })).toBe(2);

    await expect(
      assignRole({ actor: admin, userId: invited.id, roleCode: 'INSPECTOR' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await revokeRole({ actor: admin, userId: invited.id, roleCode: 'INSPECTOR' });
    expect(await ownerClient.userRole.count({ where: { userId: invited.id } })).toBe(1);

    // Die Zuweisung ist weg, das Ereignis bleibt — sonst wäre später nicht
    // mehr feststellbar, wieso jemand etwas tun durfte.
    const events = await ownerClient.auditEvent.findMany({
      where: { resourceId: invited.id, eventType: { startsWith: 'user_role.' } },
      select: { eventType: true },
      orderBy: { serverTimestamp: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['user_role.assigned', 'user_role.revoked']);
  });
});

describe('Vergessene PIN', () => {
  it('wird gelöscht, nicht neu vergeben — und der Inhaber setzt selbst', async () => {
    const { admin, worker } = await seedFixtures('pin-reset');

    await expect(confirmWithPin(worker, '4711', { purpose: 'test' })).resolves.toBeUndefined();

    await clearConfirmationPin({
      actor: admin,
      userId: worker.userId,
      reason: 'PIN vergessen, telefonisch gemeldet',
    });

    // Danach kann das Konto nichts bestätigen — auch nicht mit der alten PIN.
    await expect(confirmWithPin(worker, '4711', { purpose: 'test' })).rejects.toMatchObject({
      code: 'CONFIRMATION_FAILED',
    });

    // Und der Inhaber vergibt eine neue, ohne die alte zu kennen: das Konto
    // steht wie ein frisches da.
    await setConfirmationPin({ actor: worker, newPin: '9042' });
    await expect(confirmWithPin(worker, '9042', { purpose: 'test' })).resolves.toBeUndefined();
  });

  it('verlangt eine Begründung und hält sie im Audit-Trail fest', async () => {
    const { admin, worker } = await seedFixtures('pin-reset-reason');

    await expect(
      clearConfirmationPin({ actor: admin, userId: worker.userId, reason: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await clearConfirmationPin({ actor: admin, userId: worker.userId, reason: 'Gerät verloren' });

    const event = await ownerClient.auditEvent.findFirstOrThrow({
      where: { resourceId: worker.userId, eventType: 'confirmation_pin.cleared' },
      select: { reason: true, actorId: true },
    });
    expect(event.reason).toBe('Gerät verloren');
    // Wer zurückgesetzt hat, steht dabei — nicht der Kontoinhaber.
    expect(event.actorId).toBe(admin.userId);
  });

  it('lässt einen Worker die PIN eines anderen nicht zurücksetzen', async () => {
    const { worker } = await seedFixtures('pin-reset-denied');
    await expect(
      clearConfirmationPin({ actor: worker, userId: worker.userId, reason: 'egal' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
