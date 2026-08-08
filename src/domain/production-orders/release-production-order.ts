import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import {
  EntityVersionConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  releaseWorkStepInstance,
  type ReleasedWorkStep,
} from '@/domain/execution/release-work-step';
import {
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from './production-order-status';

export interface ReleaseProductionOrderCommand {
  actor: Actor;
  productionOrderId: string;
  expectedVersion: number;
}

export interface ReleaseProductionOrderResult {
  productionOrderId: string;
  status: ProductionOrderStatus;
  workStepInstanceCount: number;
  releasedSteps: ReleasedWorkStep[];
}

/**
 * PLANNED → RELEASED. This is where a plan becomes an executable order:
 *
 *  1. the pinned plan revision must be RELEASED — an order can never
 *     execute against a draft or superseded plan (docs/03 §1, "Plan
 *     freigegeben, alle Dokumente verfügbar"),
 *  2. one WorkStepInstance is materialized per plan step, all LOCKED,
 *  3. only the entry steps (no predecessors) are then released to READY,
 *     each with its own release token.
 *
 * Step 3 is the invariant's starting point: everything downstream stays
 * LOCKED until the server itself releases it after validating the
 * predecessor (docs/06). Materializing all instances up front — rather than
 * creating them lazily — means the full plan is visible and auditable from
 * the moment the order is released, without any of it being startable.
 */
export async function releaseProductionOrder(
  command: ReleaseProductionOrderCommand,
): Promise<ReleaseProductionOrderResult> {
  await assertPermission(command.actor, 'production_order.schedule');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const order = await tx.productionOrder.findFirst({
      where: { id: command.productionOrderId },
    });
    if (!order) throw new NotFoundError('Produktionsauftrag');
    if (order.version !== command.expectedVersion) {
      throw new EntityVersionConflictError(
        'Produktionsauftrag',
        command.expectedVersion,
        order.version,
      );
    }
    if (!isValidProductionOrderTransition(order.status as ProductionOrderStatus, 'RELEASED')) {
      throw new InvalidStateTransitionError('Produktionsauftrag', order.status, 'RELEASED');
    }

    const planRevision = await tx.productionPlanRevision.findFirst({
      where: { id: order.productionPlanRevisionId },
      include: {
        steps: {
          orderBy: { stepNumber: 'asc' },
          select: { id: true, stepNumber: true, predecessorLinks: { select: { id: true } } },
        },
      },
    });
    if (!planRevision) throw new NotFoundError('Fertigungsplan-Revision');
    if (planRevision.status !== 'RELEASED') {
      throw new ValidationError(
        `Der Fertigungsplan ist nicht freigegeben (Status: ${planRevision.status}) — der Auftrag kann nicht freigegeben werden.`,
      );
    }
    if (planRevision.steps.length === 0) {
      throw new ValidationError('Der Fertigungsplan enthält keine Arbeitsschritte.');
    }

    await tx.workStepInstance.createMany({
      data: planRevision.steps.map((step) => ({
        organizationId: command.actor.organizationId,
        productionOrderId: order.id,
        planStepId: step.id,
        stepNumber: step.stepNumber,
        status: 'LOCKED',
      })),
      skipDuplicates: true,
    });

    const updated = await tx.productionOrder.update({
      where: { id: order.id },
      data: {
        status: 'RELEASED',
        releasedById: command.actor.userId,
        releasedAt: new Date(),
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_order.released',
      resourceType: 'production_order',
      resourceId: order.id,
      actorId: command.actor.userId,
      previousValues: { status: order.status },
      newValues: {
        status: updated.status,
        productionPlanRevisionId: planRevision.id,
        workStepInstanceCount: planRevision.steps.length,
      },
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'production_order',
      aggregateId: order.id,
      eventType: 'production_order.released',
      payload: { orderId: order.id, planRevisionId: planRevision.id },
    });

    const entryStepIds = planRevision.steps
      .filter((step) => step.predecessorLinks.length === 0)
      .map((step) => step.id);
    const entryInstances = await tx.workStepInstance.findMany({
      where: { productionOrderId: order.id, planStepId: { in: entryStepIds }, status: 'LOCKED' },
      select: { id: true },
    });

    const releasedSteps: ReleasedWorkStep[] = [];
    for (const instance of entryInstances) {
      releasedSteps.push(
        await releaseWorkStepInstance(tx, {
          organizationId: command.actor.organizationId,
          workStepInstanceId: instance.id,
          releasedById: command.actor.userId,
        }),
      );
    }

    return {
      productionOrderId: order.id,
      status: updated.status as ProductionOrderStatus,
      workStepInstanceCount: planRevision.steps.length,
      releasedSteps,
    };
  });
}
