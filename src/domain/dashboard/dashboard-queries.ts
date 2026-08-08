import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { hasPermissionWithin } from '@/lib/authz/permission-within';
import type { Actor } from '@/domain/shared/actor';
import {
  countsAsPredecessorSatisfied,
  type WorkStepStatus,
} from '@/domain/execution/work-step-status';

/**
 * Dashboard — docs/07_WIREFLOWS_UX.md B1: four metric cards, the open
 * decisions, and the order overview with progress.
 *
 * The rule that governs the progress figure is stated in B1 and is the same
 * invariant as everywhere else: *"Fortschritt zählt keine
 * COMPLETED_PENDING_SYNC-Schritte als final abgeschlossen"*. Locally finished
 * work is reported separately, as `pendingSteps`, so the UI can show it
 * without it ever being counted as done.
 */

export interface DashboardMetrics {
  activeOrders: number;
  overdueOrders: number;
  openNonConformances: number;
  blockedOrders: number;
}

export interface OpenDecision {
  kind: 'SYNC_CONFLICT' | 'NON_CONFORMANCE' | 'SECOND_APPROVAL';
  id: string;
  label: string;
  detail: string;
  href: string;
  since: Date;
}

export interface OrderOverviewRow {
  productionOrderId: string;
  orderNumber: string;
  productName: string;
  status: string;
  /** Server-confirmed steps only. */
  completedSteps: number;
  /** Locally finished, not yet server-confirmed — shown apart, never added
   *  into the percentage (docs/07 B1). */
  pendingSteps: number;
  totalSteps: number;
  progressPercent: number;
  assignees: string[];
  plannedEndAt: Date | null;
  isOverdue: boolean;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  openDecisions: OpenDecision[];
  orders: OrderOverviewRow[];
}

const ACTIVE_ORDER_STATUSES = ['RELEASED', 'IN_PROGRESS', 'PAUSED'];
const BLOCKED_ORDER_STATUSES = ['ON_HOLD', 'QUALITY_BLOCKED'];

export async function getDashboard(actor: Actor): Promise<DashboardData> {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const now = new Date();

    const orders = await tx.productionOrder.findMany({
      where: { status: { in: [...ACTIVE_ORDER_STATUSES, ...BLOCKED_ORDER_STATUSES] } },
      orderBy: { orderNumber: 'asc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        plannedEndAt: true,
        product: { select: { name: true } },
        assignments: {
          where: { revokedAt: null },
          select: { user: { select: { displayName: true, email: true } } },
        },
        workStepInstances: {
          select: { planStepId: true, status: true, attemptNumber: true },
        },
      },
    });

    const rows = orders.map((order) => {
      // Only the latest attempt per plan step counts — the same rule the
      // successor release and the order-completion check use, so the
      // dashboard cannot disagree with them (see releaseEligibleSuccessors).
      const latestByPlanStep = new Map<string, { status: string; attemptNumber: number }>();
      for (const instance of order.workStepInstances) {
        const current = latestByPlanStep.get(instance.planStepId);
        if (!current || instance.attemptNumber > current.attemptNumber) {
          latestByPlanStep.set(instance.planStepId, instance);
        }
      }
      const steps = [...latestByPlanStep.values()];
      const completed = steps.filter((s) =>
        countsAsPredecessorSatisfied(s.status as WorkStepStatus),
      ).length;
      const pending = steps.filter(
        (s) => s.status === 'COMPLETED_PENDING_SYNC' || s.status === 'WAITING_FOR_SERVER',
      ).length;

      return {
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        productName: order.product.name,
        status: order.status,
        completedSteps: completed,
        pendingSteps: pending,
        totalSteps: steps.length,
        progressPercent: steps.length === 0 ? 0 : Math.round((completed / steps.length) * 100),
        assignees: order.assignments.map((a) => a.user.displayName ?? a.user.email),
        plannedEndAt: order.plannedEndAt,
        isOverdue: order.plannedEndAt !== null && order.plannedEndAt < now,
      };
    });

    const openNonConformances = await tx.nonConformance.count({
      where: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
    });

    return {
      metrics: {
        activeOrders: rows.filter((r) => ACTIVE_ORDER_STATUSES.includes(r.status)).length,
        overdueOrders: rows.filter((r) => r.isOverdue).length,
        openNonConformances,
        blockedOrders: rows.filter((r) => BLOCKED_ORDER_STATUSES.includes(r.status)).length,
      },
      openDecisions: await collectOpenDecisions(tx, actor),
      orders: rows,
    };
  });
}

/**
 * "Offene Entscheidungen" from B1 — the things waiting on a person rather
 * than on the shop floor. Each block is gated on the permission that would
 * let the viewer actually decide it: a list of decisions somebody cannot make
 * is noise, and worse, it discloses that they exist.
 */
async function collectOpenDecisions(
  tx: Prisma.TransactionClient,
  actor: Actor,
): Promise<OpenDecision[]> {
  const decisions: OpenDecision[] = [];

  if (await hasPermissionWithin(tx, actor, 'sync_conflict.decide')) {
    const conflicts = await tx.syncConflict.findMany({
      where: { status: 'OPEN' },
      orderBy: { detectedAt: 'asc' },
      take: 20,
      select: {
        id: true,
        conflictType: true,
        summary: true,
        detectedAt: true,
        productionOrder: { select: { orderNumber: true } },
        workStepInstance: { select: { stepNumber: true } },
      },
    });
    for (const conflict of conflicts) {
      decisions.push({
        kind: 'SYNC_CONFLICT',
        id: conflict.id,
        label: conflict.conflictType,
        detail:
          `${conflict.productionOrder?.orderNumber ?? '—'}` +
          `${conflict.workStepInstance ? ` · Schritt ${conflict.workStepInstance.stepNumber}` : ''} — ${conflict.summary}`,
        href: `/sync/conflicts/${conflict.id}`,
        since: conflict.detectedAt,
      });
    }
  }

  if (await hasPermissionWithin(tx, actor, 'ncr.assess')) {
    const ncrs = await tx.nonConformance.findMany({
      where: { status: { in: ['OPEN', 'ASSESSMENT_REQUIRED', 'AWAITING_DISPOSITION'] } },
      orderBy: { discoveredAt: 'asc' },
      take: 20,
      select: {
        id: true,
        ncrNumber: true,
        status: true,
        isBlocking: true,
        discoveredAt: true,
        productionOrder: { select: { orderNumber: true } },
      },
    });
    for (const ncr of ncrs) {
      decisions.push({
        kind: 'NON_CONFORMANCE',
        id: ncr.id,
        label: ncr.ncrNumber,
        detail:
          `${ncr.productionOrder.orderNumber} · ${ncr.status}` +
          (ncr.isBlocking ? ' · blockierend' : ''),
        href: `/quality/ncrs/${ncr.id}`,
        since: ncr.discoveredAt,
      });
    }
  }

  if (await hasPermissionWithin(tx, actor, 'second_approval.decide')) {
    const approvals = await tx.secondApproval.findMany({
      where: {
        reviewerStatus: 'PENDING',
        // The four-eyes rule, applied to the list itself: a person's own
        // execution never appears among the decisions they are offered.
        executorId: { not: actor.userId },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        workStepInstance: {
          select: {
            id: true,
            stepNumber: true,
            planStep: { select: { title: true } },
            productionOrder: { select: { orderNumber: true } },
          },
        },
      },
    });
    for (const approval of approvals) {
      decisions.push({
        kind: 'SECOND_APPROVAL',
        id: approval.id,
        label: 'Vier-Augen-Prüfung',
        detail: `${approval.workStepInstance.productionOrder.orderNumber} · Schritt ${approval.workStepInstance.stepNumber} — ${approval.workStepInstance.planStep.title}`,
        href: `/work-steps/${approval.workStepInstance.id}`,
        since: approval.createdAt,
      });
    }
  }

  return decisions.sort((a, b) => a.since.getTime() - b.since.getTime());
}
