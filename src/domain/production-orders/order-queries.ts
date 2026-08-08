import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { hasPermissionWithin } from '@/lib/authz/permission-within';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  countsAsPredecessorSatisfied,
  type WorkStepStatus,
} from '@/domain/execution/work-step-status';
import { assertOrderVisible } from './order-access';

/** Statuses an order can be in while it is still someone's active work. */
const ACTIVE_ORDER_STATUSES = ['RELEASED', 'IN_PROGRESS', 'PAUSED', 'ON_HOLD', 'QUALITY_BLOCKED'];

export interface MyOrderSummary {
  id: string;
  orderNumber: string;
  serialNumber: string | null;
  status: string;
  productName: string;
  totalSteps: number;
  completedSteps: number;
  /** The step this worker should look at next: the first READY/IN_PROGRESS/
   *  PAUSED one, or null if the order is currently waiting on something
   *  else (a locked successor, a hold, another person's step). */
  currentStep: { id: string; stepNumber: number; title: string; status: string } | null;
}

/**
 * "Meine Aufträge" (docs/07 A1) — assignment-scoped by construction, not by
 * a filter the caller could forget: the query starts from the actor's own
 * assignments.
 */
export async function listMyOrders(actor: Actor): Promise<MyOrderSummary[]> {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const orders = await tx.productionOrder.findMany({
      where: {
        status: { in: ACTIVE_ORDER_STATUSES },
        assignments: { some: { userId: actor.userId, revokedAt: null } },
      },
      include: {
        product: { select: { name: true } },
        workStepInstances: {
          orderBy: { stepNumber: 'asc' },
          include: { planStep: { select: { title: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return orders.map((order) => {
      const actionable = order.workStepInstances.find((instance) =>
        ['READY', 'IN_PROGRESS', 'PAUSED', 'COMPLETION_REJECTED'].includes(instance.status),
      );
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        serialNumber: order.serialNumber,
        status: order.status,
        productName: order.product.name,
        totalSteps: order.workStepInstances.length,
        completedSteps: order.workStepInstances.filter((i) =>
          countsAsPredecessorSatisfied(i.status as WorkStepStatus),
        ).length,
        currentStep: actionable
          ? {
              id: actionable.id,
              stepNumber: actionable.stepNumber,
              title: actionable.planStep.title,
              status: actionable.status,
            }
          : null,
      };
    });
  });
}

export async function getProductionOrder(actor: Actor, productionOrderId: string) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const order = await tx.productionOrder.findFirst({
      where: { id: productionOrderId },
      include: {
        project: { select: { id: true, projectNumber: true, name: true } },
        product: { select: { id: true, name: true, productNumber: true } },
        productionPlanRevision: {
          select: { id: true, revisionNumber: true, status: true, productionPlanId: true },
        },
        assignments: {
          where: { revokedAt: null },
          include: { user: { select: { id: true, displayName: true, email: true } } },
        },
        workStepInstances: {
          orderBy: { stepNumber: 'asc' },
          include: { planStep: { select: { title: true, fourEyesRequired: true } } },
        },
      },
    });
    if (!order) throw new NotFoundError('Produktionsauftrag');
    await assertOrderVisible(tx, actor, order.id);
    return order;
  });
}

export async function listProductionOrders(
  actor: Actor,
  filter?: { projectId?: string; status?: string },
) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    // Assignment-scoped roles (WORKER, INSPECTOR) see only their own orders
    // here too — a list endpoint must never leak what the detail endpoint
    // would deny. See order-access.ts for why audit.view is the
    // discriminator between the two visibility classes.
    const unrestricted = await hasUnrestrictedVisibility(tx, actor);

    return tx.productionOrder.findMany({
      where: {
        projectId: filter?.projectId,
        status: filter?.status,
        ...(unrestricted
          ? {}
          : { assignments: { some: { userId: actor.userId, revokedAt: null } } }),
      },
      include: {
        product: { select: { name: true } },
        _count: { select: { workStepInstances: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });
}

function hasUnrestrictedVisibility(tx: Prisma.TransactionClient, actor: Actor): Promise<boolean> {
  // Same discriminator as assertOrderVisible() — see order-access.ts for
  // why audit.view separates the two visibility classes.
  return hasPermissionWithin(tx, actor, 'audit.view');
}
