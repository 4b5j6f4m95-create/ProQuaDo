import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export interface AssignProductionOrderCommand {
  actor: Actor;
  productionOrderId: string;
  userId: string;
  role?: string;
}

/**
 * Grants a user execution access to one order. This is what makes a step
 * appear in that user's "Meine Aufträge" (docs/07 A1) and, more
 * importantly, what assertAssignedToOrder() checks before any execution
 * action — visibility and executability both hang off this row, not off the
 * UI (docs/04 "Zuweisung").
 */
export async function assignProductionOrder(command: AssignProductionOrderCommand) {
  await assertPermission(command.actor, 'production_order.assign');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const order = await tx.productionOrder.findFirst({ where: { id: command.productionOrderId } });
    if (!order) throw new NotFoundError('Produktionsauftrag');

    // RLS keeps this query inside the tenant, so a user id from another
    // organization simply does not resolve.
    const user = await tx.user.findFirst({ where: { id: command.userId, isActive: true } });
    if (!user) throw new NotFoundError('Benutzer');

    const assignment = await tx.orderAssignment.upsert({
      where: {
        organizationId_productionOrderId_userId: {
          organizationId: command.actor.organizationId,
          productionOrderId: order.id,
          userId: user.id,
        },
      },
      create: {
        organizationId: command.actor.organizationId,
        productionOrderId: order.id,
        userId: user.id,
        role: command.role,
        assignedById: command.actor.userId,
      },
      // Re-assigning someone previously revoked reactivates the assignment
      // rather than creating a second row.
      update: { role: command.role, assignedById: command.actor.userId, revokedAt: null },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_order.assigned',
      resourceType: 'production_order',
      resourceId: order.id,
      actorId: command.actor.userId,
      newValues: { assignedUserId: user.id, role: command.role },
      source: 'web',
    });

    return assignment;
  });
}

export interface RevokeProductionOrderAssignmentCommand {
  actor: Actor;
  productionOrderId: string;
  userId: string;
  reason?: string;
}

/**
 * Revokes access. The row is kept (with revokedAt set) rather than deleted:
 * "wer war wann zugewiesen" is part of the production record, and work
 * already performed under the assignment stays attributable
 * (docs/04 "Rechteänderungen und Offline-Konsequenzen").
 */
export async function revokeProductionOrderAssignment(
  command: RevokeProductionOrderAssignmentCommand,
) {
  await assertPermission(command.actor, 'production_order.assign');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const assignment = await tx.orderAssignment.findFirst({
      where: {
        productionOrderId: command.productionOrderId,
        userId: command.userId,
        revokedAt: null,
      },
    });
    if (!assignment) throw new NotFoundError('Auftragszuweisung');

    const updated = await tx.orderAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date() },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_order.assignment_revoked',
      resourceType: 'production_order',
      resourceId: command.productionOrderId,
      actorId: command.actor.userId,
      previousValues: { assignedUserId: command.userId },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}
