import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { allow, deny, type Decision } from './decision';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';

export interface AuthzCheck {
  userId: string;
  organizationId: string;
  action: PermissionCode;
  /** Qualification code required for this specific action, if any (ABAC). */
  requiredQualification?: string;
  /** Execution time to check qualification validity against — defaults to
   *  now. Pass the actual execution timestamp when validating a completion
   *  that happened earlier, per docs/04 "Qualifikationen und Gültigkeit". */
  atTimestamp?: Date;
}

/**
 * Serverside RBAC + ABAC authorization check. This is the ONLY function
 * that may answer "is this action allowed" — no route handler or domain
 * service should inline a permission check. See docs/04_ROLES_PERMISSIONS_MATRIX.md.
 *
 * Organization boundary is enforced twice: once implicitly by withOrgContext
 * (RLS makes cross-org rows invisible) and once explicitly by requiring the
 * caller to pass organizationId matching the session — defense in depth
 * matching ADR-006.
 */
export async function can(check: AuthzCheck): Promise<Decision> {
  return withOrgContext(check.organizationId, async (tx) => {
    const hasPermission = await userHasPermission(
      tx,
      check.userId,
      check.organizationId,
      check.action,
    );
    if (!hasPermission) {
      return deny('PERMISSION_DENIED');
    }

    if (check.requiredQualification) {
      const qualified = await isCurrentlyQualified(
        tx,
        check.userId,
        check.requiredQualification,
        check.atTimestamp ?? new Date(),
      );
      if (!qualified) {
        return deny('NOT_QUALIFIED');
      }
    }

    return allow();
  });
}

async function userHasPermission(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  action: PermissionCode,
): Promise<boolean> {
  const now = new Date();
  const grant = await tx.userRole.findFirst({
    where: {
      userId,
      organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      role: {
        rolePermissions: {
          some: { permission: { code: action } },
        },
      },
    },
    select: { id: true },
  });
  return grant !== null;
}

async function isCurrentlyQualified(
  tx: Prisma.TransactionClient,
  userId: string,
  qualificationCode: string,
  atTimestamp: Date,
): Promise<boolean> {
  const record = await tx.employeeQualification.findFirst({
    where: {
      employee: { userId },
      qualification: { code: qualificationCode },
      certifiedAt: { lte: atTimestamp },
      OR: [{ expiresAt: null }, { expiresAt: { gt: atTimestamp } }],
    },
    select: { id: true },
  });
  return record !== null;
}
