import type { Prisma } from '@prisma/client';
import { AuthzError } from './errors';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';
import type { Actor } from '@/domain/shared/actor';

/**
 * Transaction-scoped RBAC check, for the cases where the permission to
 * require depends on data that has to be read first — e.g. a work step
 * whose kind decides whether `work_step.execute`, `rework.execute` or
 * `reinspection.execute` applies.
 *
 * The usual path stays assertPermission() (src/lib/authz/assert-permission.ts),
 * which every service calls before it opens a transaction. This variant
 * exists so such a data-dependent check does not have to open a SECOND,
 * independent transaction in the middle of a mutation — the answer would be
 * read outside the very transaction whose writes it guards.
 */
export async function hasPermissionWithin(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: PermissionCode,
): Promise<boolean> {
  const grant = await tx.userRole.findFirst({
    where: {
      userId: actor.userId,
      organizationId: actor.organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      role: { rolePermissions: { some: { permission: { code: action } } } },
    },
    select: { id: true },
  });
  return grant !== null;
}

export async function assertPermissionWithin(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: PermissionCode,
  message?: string,
): Promise<void> {
  if (!(await hasPermissionWithin(tx, actor, action))) {
    throw new AuthzError(
      'PERMISSION_DENIED',
      message ?? 'Sie besitzen nicht die erforderliche Berechtigung für diese Aktion.',
    );
  }
}
