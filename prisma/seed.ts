// Seeding is an administrative bootstrap operation, like migrations — it
// runs against DIRECT_DATABASE_URL (schema-owning role, bypasses RLS) via
// its own PrismaClient instance, NOT the app's RLS-restricted singleton in
// src/lib/db/client.ts. Never reuse this pattern inside request handling.
import { PrismaClient } from '@prisma/client';
import { seedOrganizationRbac, seedDemoUsers } from '../src/domain/identity/seed-organization';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL } },
});

const DEMO_ORG_NAME = 'ProQuaDo Demo GmbH';

async function main(): Promise<void> {
  const seeded = await seedOrganizationRbac(db, DEMO_ORG_NAME);
  console.log(`Organization: ${DEMO_ORG_NAME} (${seeded.organizationId})`);
  console.log(`Roles seeded: ${Object.keys(seeded.roleIdByCode).length}`);

  // Demo users matching infra/keycloak/proquado-realm.json. On first SSO
  // login, resolve_org_for_login() links external_id via the
  // 'pending:<email>' sentinel — see src/lib/auth/resolve-login.ts.
  const userIds = await seedDemoUsers(db, seeded, [
    { email: 'admin.test@proquado.local', displayName: 'Admin Test', roleCode: 'ADMIN' },
    { email: 'worker.test@proquado.local', displayName: 'Worker Test', roleCode: 'WORKER' },
    { email: 'pl.test@proquado.local', displayName: 'Project Lead Test', roleCode: 'PROJECT_LEAD' },
    {
      email: 'qm.test@proquado.local',
      displayName: 'Quality Manager Test',
      roleCode: 'QUALITY_MANAGER',
    },
  ]);
  for (const [email, id] of Object.entries(userIds)) {
    console.log(`Demo user ${email} (${id}) — pending first login`);
  }

  // Minimal demo fixtures so Phase 2 UI has something to show on first run.
  const site = await db.site.upsert({
    where: { organizationId_code: { organizationId: seeded.organizationId, code: 'HQ' } },
    update: {},
    create: { organizationId: seeded.organizationId, code: 'HQ', name: 'Hauptstandort' },
  });
  const customer = await db.customer.upsert({
    where: {
      organizationId_customerNumber: {
        organizationId: seeded.organizationId,
        customerNumber: 'CUST-001',
      },
    },
    update: {},
    create: {
      organizationId: seeded.organizationId,
      customerNumber: 'CUST-001',
      name: 'Musterfirma GmbH',
    },
  });
  const projectLeadId = userIds['pl.test@proquado.local'];
  if (!projectLeadId) throw new Error('pl.test user was not seeded');

  const project = await db.project.upsert({
    where: {
      organizationId_projectNumber: {
        organizationId: seeded.organizationId,
        projectNumber: 'PROJ-2026-0001',
      },
    },
    update: {},
    create: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      projectNumber: 'PROJ-2026-0001',
      name: 'Demo-Projekt Gehäusebaugruppe',
      customerId: customer.id,
      createdById: projectLeadId,
      status: 'ACTIVE',
    },
  });
  await db.product.upsert({
    where: {
      organizationId_productNumber: {
        organizationId: seeded.organizationId,
        productNumber: 'PROD-001',
      },
    },
    update: {},
    create: {
      organizationId: seeded.organizationId,
      projectId: project.id,
      productNumber: 'PROD-001',
      name: 'Gehäuse Baugruppe A',
    },
  });
  console.log(`Demo project: ${project.name} (${project.id})`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
