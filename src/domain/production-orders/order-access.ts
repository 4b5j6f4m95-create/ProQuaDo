import type { Prisma } from '@prisma/client';
import { AuthzError } from '@/lib/authz/errors';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';
import type { Actor } from '@/domain/shared/actor';

/**
 * The ABAC layer on top of RBAC for production orders — docs/04
 * "ABAC-Kontextregeln": WORKER and INSPECTOR hold `production_order.view`
 * only "(zugewiesen)", every other role holds it unconditionally.
 *
 * That distinction is not expressible as a permission atom, so it is
 * derived from one: in the permission matrix, exactly the roles with
 * unrestricted order visibility (ADMIN, QUALITY_MANAGER, PROJECT_LEAD,
 * PRODUCTION_MANAGER, AUDITOR) also hold `audit.view`, and exactly the
 * assignment-scoped ones (WORKER, INSPECTOR) do not. Using that as the
 * discriminator keeps a single source of truth (system-roles.ts) instead of
 * a second, silently divergent list of "broad" roles here.
 */

async function hasPermission(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: PermissionCode,
): Promise<boolean> {
  const now = new Date();
  const grant = await tx.userRole.findFirst({
    where: {
      userId: actor.userId,
      organizationId: actor.organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      role: { rolePermissions: { some: { permission: { code: action } } } },
    },
    select: { id: true },
  });
  return grant !== null;
}

export async function isAssignedToOrder(
  tx: Prisma.TransactionClient,
  actor: Actor,
  productionOrderId: string,
): Promise<boolean> {
  const assignment = await tx.orderAssignment.findFirst({
    where: { productionOrderId, userId: actor.userId, revokedAt: null },
    select: { id: true },
  });
  return assignment !== null;
}

/**
 * Read access. Throws CROSS_TENANT_ACCESS_DENIED (→ 404) rather than 403 so
 * that an unassigned user cannot distinguish "exists but not yours" from
 * "does not exist" — the IDOR guidance in docs/08_THREAT_MODEL_PRIVACY.md.
 */
export async function assertOrderVisible(
  tx: Prisma.TransactionClient,
  actor: Actor,
  productionOrderId: string,
): Promise<void> {
  if (await hasPermission(tx, actor, 'audit.view')) return;
  if (await isAssignedToOrder(tx, actor, productionOrderId)) return;
  throw new AuthzError('CROSS_TENANT_ACCESS_DENIED', 'Zugriff verweigert.');
}

/**
 * Execution access — strictly stronger than visibility: holding
 * `work_step.execute` is not enough, the actor must also be assigned to
 * this specific order. No "broad role" bypass exists here on purpose; a QM
 * or admin who wants to execute a step must be assigned to the order like
 * anyone else, so the production record always names a real executor.
 */
export async function assertAssignedToOrder(
  tx: Prisma.TransactionClient,
  actor: Actor,
  productionOrderId: string,
): Promise<void> {
  if (await isAssignedToOrder(tx, actor, productionOrderId)) return;
  throw new AuthzError('PERMISSION_DENIED', 'Sie sind diesem Produktionsauftrag nicht zugewiesen.');
}
