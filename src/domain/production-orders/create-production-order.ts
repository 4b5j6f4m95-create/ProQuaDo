import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import {
  EntityVersionConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from './production-order-status';

export interface CreateProductionOrderCommand {
  actor: Actor;
  projectId: string;
  productId: string;
  productionPlanRevisionId: string;
  orderNumber: string;
  quantity?: number;
  batchNumber?: string;
  serialNumber?: string;
  plannedStartAt?: Date;
  plannedEndAt?: Date;
}

/**
 * Creates a production order in DRAFT, pinned to ONE plan revision. The
 * revision is chosen here and never re-resolved afterwards: "der Auftrag
 * folgt der Revision, mit der er freigegeben wurde" (Geschäftsgrundsatz 6).
 * A later plan revision therefore cannot silently change a running order —
 * it becomes a revision conflict that a human decides (Abnahmeszenario C,
 * Phase 5).
 */
export async function createProductionOrder(command: CreateProductionOrderCommand) {
  await assertPermission(command.actor, 'production_order.create');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const project = await tx.project.findFirst({ where: { id: command.projectId } });
    if (!project) throw new NotFoundError('Projekt');

    const product = await tx.product.findFirst({ where: { id: command.productId } });
    if (!product) throw new NotFoundError('Produkt');
    if (product.projectId !== project.id) {
      throw new ValidationError('Das Produkt gehört nicht zu diesem Projekt.');
    }

    const planRevision = await tx.productionPlanRevision.findFirst({
      where: { id: command.productionPlanRevisionId },
      include: { productionPlan: { select: { productId: true } } },
    });
    if (!planRevision) throw new NotFoundError('Fertigungsplan-Revision');
    if (planRevision.productionPlan.productId !== product.id) {
      throw new ValidationError('Der Fertigungsplan gehört nicht zu diesem Produkt.');
    }

    const order = await tx.productionOrder.create({
      data: {
        organizationId: command.actor.organizationId,
        siteId: project.siteId,
        projectId: project.id,
        productId: product.id,
        productionPlanRevisionId: planRevision.id,
        orderNumber: command.orderNumber,
        quantity: command.quantity ?? 1,
        batchNumber: command.batchNumber,
        serialNumber: command.serialNumber,
        plannedStartAt: command.plannedStartAt,
        plannedEndAt: command.plannedEndAt,
        status: 'DRAFT',
        createdById: command.actor.userId,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_order.created',
      resourceType: 'production_order',
      resourceId: order.id,
      actorId: command.actor.userId,
      newValues: {
        orderNumber: order.orderNumber,
        productionPlanRevisionId: planRevision.id,
        serialNumber: order.serialNumber,
        status: order.status,
      },
      source: 'web',
    });

    return order;
  });
}

export interface TransitionProductionOrderCommand {
  actor: Actor;
  productionOrderId: string;
  toStatus: ProductionOrderStatus;
  expectedVersion: number;
  reason?: string;
}

/**
 * Manual status transitions (DRAFT→PLANNED, ON_HOLD, PAUSED, CANCELLED, …).
 * RELEASED is deliberately NOT reachable through here — it materializes
 * work step instances and issues release tokens, so it has its own service
 * (release-production-order.ts) that cannot be invoked by accident.
 */
export async function transitionProductionOrderStatus(command: TransitionProductionOrderCommand) {
  await assertPermission(command.actor, 'production_order.schedule');

  if (command.toStatus === 'RELEASED') {
    throw new ValidationError(
      'Die Freigabe eines Produktionsauftrags erfolgt über releaseProductionOrder().',
    );
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const order = await tx.productionOrder.findFirst({ where: { id: command.productionOrderId } });
    if (!order) throw new NotFoundError('Produktionsauftrag');
    if (order.version !== command.expectedVersion) {
      throw new EntityVersionConflictError(
        'Produktionsauftrag',
        command.expectedVersion,
        order.version,
      );
    }
    if (
      !isValidProductionOrderTransition(order.status as ProductionOrderStatus, command.toStatus)
    ) {
      throw new InvalidStateTransitionError('Produktionsauftrag', order.status, command.toStatus);
    }

    const updated = await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: command.toStatus, version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_order.status_changed',
      resourceType: 'production_order',
      resourceId: order.id,
      actorId: command.actor.userId,
      previousValues: { status: order.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}
