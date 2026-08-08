import type { PrismaClient } from '@prisma/client';
import { hashConfirmationPin } from '@/lib/auth/confirmation-pin';
import { PERMISSIONS } from './permissions-catalog';
import { SYSTEM_ROLES, type SystemRoleCode } from './system-roles';

// Shared by prisma/seed.ts (real bootstrap) and integration tests (fixture
// setup) — a single source of truth for "what does a freshly provisioned
// organization's RBAC look like" so tests exercise the real seeding logic
// instead of a parallel approximation of it.

export interface SeededOrganization {
  organizationId: string;
  roleIdByCode: Record<SystemRoleCode, string>;
}

export async function seedOrganizationRbac(
  db: PrismaClient,
  organizationName: string,
): Promise<SeededOrganization> {
  const org = await db.organization.upsert({
    where: { name: organizationName },
    update: {},
    create: { name: organizationName },
  });

  const permissionByCode = new Map<string, string>();
  for (const def of PERMISSIONS) {
    const permission = await db.permission.upsert({
      where: { organizationId_code: { organizationId: org.id, code: def.code } },
      update: { name: def.name, resource: def.resource, action: def.action },
      create: {
        organizationId: org.id,
        code: def.code,
        name: def.name,
        resource: def.resource,
        action: def.action,
      },
    });
    permissionByCode.set(def.code, permission.id);
  }

  const roleIdByCode = {} as Record<SystemRoleCode, string>;
  for (const [roleCode, def] of Object.entries(SYSTEM_ROLES) as [
    SystemRoleCode,
    (typeof SYSTEM_ROLES)[SystemRoleCode],
  ][]) {
    const role = await db.role.upsert({
      where: { organizationId_code: { organizationId: org.id, code: roleCode } },
      update: { name: def.name, isSystem: true },
      create: { organizationId: org.id, code: roleCode, name: def.name, isSystem: true },
    });
    roleIdByCode[roleCode] = role.id;

    for (const permCode of def.permissions) {
      const permissionId = permissionByCode.get(permCode);
      if (!permissionId) {
        throw new Error(`system-roles.ts references unknown permission "${permCode}"`);
      }
      await db.rolePermission.upsert({
        where: {
          organizationId_roleId_permissionId: {
            organizationId: org.id,
            roleId: role.id,
            permissionId,
          },
        },
        update: {},
        create: { organizationId: org.id, roleId: role.id, permissionId },
      });
    }
  }

  return { organizationId: org.id, roleIdByCode };
}

export interface DemoUserSpec {
  email: string;
  displayName: string;
  roleCode: SystemRoleCode;
  /** Development/demo convenience only. Real users set their own PIN;
   *  seeding one is acceptable for demo accounts and for integration tests
   *  that need to exercise step confirmation (docs/07 A5). */
  confirmationPin?: string;
}

export async function seedDemoUsers(
  db: PrismaClient,
  seeded: SeededOrganization,
  users: readonly DemoUserSpec[],
): Promise<Record<string, string>> {
  const site = await db.site.upsert({
    where: { organizationId_code: { organizationId: seeded.organizationId, code: 'HQ' } },
    update: {},
    create: { organizationId: seeded.organizationId, code: 'HQ', name: 'Hauptstandort' },
  });

  const userIdByEmail: Record<string, string> = {};

  for (const demo of users) {
    const confirmationPinHash = demo.confirmationPin
      ? await hashConfirmationPin(demo.confirmationPin)
      : undefined;

    const user = await db.user.upsert({
      where: {
        organizationId_externalId: {
          organizationId: seeded.organizationId,
          externalId: `pending:${demo.email}`,
        },
      },
      update: { confirmationPinHash },
      create: {
        organizationId: seeded.organizationId,
        externalId: `pending:${demo.email}`,
        email: demo.email,
        displayName: demo.displayName,
        confirmationPinHash,
      },
    });
    userIdByEmail[demo.email] = user.id;

    await db.employee.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        organizationId: seeded.organizationId,
        userId: user.id,
        employeeNumber: (demo.email.split('@')[0] ?? demo.email).toUpperCase(),
        siteId: site.id,
      },
    });

    const roleId = seeded.roleIdByCode[demo.roleCode];
    await db.userRole.upsert({
      where: {
        organizationId_userId_roleId: {
          organizationId: seeded.organizationId,
          userId: user.id,
          roleId,
        },
      },
      update: {},
      create: { organizationId: seeded.organizationId, userId: user.id, roleId },
    });
  }

  return userIdByEmail;
}
