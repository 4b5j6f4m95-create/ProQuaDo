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
  ]);
  for (const [email, id] of Object.entries(userIds)) {
    console.log(`Demo user ${email} (${id}) — pending first login`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
