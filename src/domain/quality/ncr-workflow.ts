import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  releaseEligibleSuccessors,
  releaseWorkStepInstance,
} from '@/domain/execution/release-work-step';
import {
  countsAsPredecessorSatisfied,
  type WorkStepStatus,
} from '@/domain/execution/work-step-status';
import {
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from '@/domain/production-orders/production-order-status';
import { releaseProductionHoldWithin } from './production-holds';
import {
  isValidNonConformanceTransition,
  type DispositionType,
  type NonConformanceStatus,
} from './ncr-status';
import { applyBlockingConsequences } from './raise-non-conformance';

/**
 * The QM side of the quality process (docs/07 C2), following the state
 * machine in docs/03 §5:
 *
 *   OPEN → ASSESSMENT_REQUIRED → CONTAINMENT → REWORK → REINSPECTION
 *        → AWAITING_DISPOSITION → CLOSED
 *
 * Rework and reinspection are executed as their own work step instances
 * derived from the failed original (MASTERPROMPT.md Kap. 9). The original
 * is never re-opened and never rewritten as if it had succeeded — it stays
 * BLOCKED in the history, and the derived attempt carries the new evidence.
 */

async function loadNcrOrThrow(tx: Prisma.TransactionClient, nonConformanceId: string) {
  const ncr = await tx.nonConformance.findFirst({ where: { id: nonConformanceId } });
  if (!ncr) throw new NotFoundError('Abweichung');
  return ncr;
}

function assertTransition(from: string, to: NonConformanceStatus): void {
  if (!isValidNonConformanceTransition(from as NonConformanceStatus, to)) {
    throw new InvalidStateTransitionError('Abweichung', from, to);
  }
}

export interface AssessNonConformanceCommand {
  actor: Actor;
  nonConformanceId: string;
  assessmentNotes: string;
  /** QM may re-classify in BOTH directions — this is the only place the
   *  blocking flag can be lowered, and it demands a written assessment. */
  isBlocking?: boolean;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  errorCategory?: string;
  assignedToId?: string;
  dueDate?: Date;
}

export async function assessNonConformance(command: AssessNonConformanceCommand) {
  await assertPermission(command.actor, 'ncr.assess');

  if (!command.assessmentNotes.trim()) {
    throw new ValidationError('Die Bewertung einer Abweichung erfordert eine Begründung.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await loadNcrOrThrow(tx, command.nonConformanceId);
    assertTransition(ncr.status, 'ASSESSMENT_REQUIRED');

    const nextBlocking = command.isBlocking ?? ncr.isBlocking;
    const updated = await tx.nonConformance.update({
      where: { id: ncr.id },
      data: {
        status: 'ASSESSMENT_REQUIRED',
        assessmentNotes: command.assessmentNotes,
        isBlocking: nextBlocking,
        priority: command.priority ?? ncr.priority,
        errorCategory: command.errorCategory ?? ncr.errorCategory,
        assignedToId: command.assignedToId ?? ncr.assignedToId,
        dueDate: command.dueDate ?? ncr.dueDate,
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'non_conformance.assessed',
      resourceType: 'non_conformance',
      resourceId: ncr.id,
      actorId: command.actor.userId,
      previousValues: { status: ncr.status, isBlocking: ncr.isBlocking, priority: ncr.priority },
      newValues: { status: updated.status, isBlocking: nextBlocking, priority: updated.priority },
      reason: command.assessmentNotes,
      source: 'web',
    });

    // Escalating to blocking after the fact must have the same consequences
    // as raising it blocking in the first place; de-escalating must lift
    // them again, otherwise the order would stay frozen by a hold nobody
    // can explain.
    if (!ncr.isBlocking && nextBlocking) {
      const order = await tx.productionOrder.findFirstOrThrow({
        where: { id: ncr.productionOrderId },
        select: { id: true, status: true },
      });
      await applyBlockingConsequences(tx, {
        actor: command.actor,
        ncrId: ncr.id,
        ncrNumber: ncr.ncrNumber,
        productionOrderId: order.id,
        orderStatus: order.status,
        workStepInstanceId: ncr.workStepInstanceId ?? undefined,
        reason: `NCR ${ncr.ncrNumber} als blockierend bewertet: ${command.assessmentNotes}`,
      });
    } else if (ncr.isBlocking && !nextBlocking) {
      await liftBlockingConsequences(tx, {
        actor: command.actor,
        nonConformanceId: ncr.id,
        productionOrderId: ncr.productionOrderId,
        reason: `NCR ${ncr.ncrNumber} als nicht blockierend bewertet: ${command.assessmentNotes}`,
      });
    }

    return updated;
  });
}

export interface ContainNonConformanceCommand {
  actor: Actor;
  nonConformanceId: string;
  immediateAction: string;
  rootCause?: string;
}

export async function containNonConformance(command: ContainNonConformanceCommand) {
  await assertPermission(command.actor, 'ncr.assess');

  if (!command.immediateAction.trim()) {
    throw new ValidationError('Eine Eindämmung erfordert die Beschreibung der Sofortmaßnahme.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await loadNcrOrThrow(tx, command.nonConformanceId);
    assertTransition(ncr.status, 'CONTAINMENT');

    const updated = await tx.nonConformance.update({
      where: { id: ncr.id },
      data: {
        status: 'CONTAINMENT',
        immediateAction: command.immediateAction,
        rootCause: command.rootCause ?? ncr.rootCause,
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'non_conformance.contained',
      resourceType: 'non_conformance',
      resourceId: ncr.id,
      actorId: command.actor.userId,
      previousValues: { status: ncr.status },
      newValues: { status: updated.status, immediateAction: command.immediateAction },
      source: 'web',
    });

    return updated;
  });
}

export interface CreateDerivedStepCommand {
  actor: Actor;
  nonConformanceId: string;
  instruction?: string;
}

/**
 * Creates the rework step: a new work step instance for the same plan step,
 * linked to the failed original and to this NCR, released READY with its
 * own token. It is startable even though the order is on hold — the hold
 * exists to stop REGULAR production, not the repair it demands.
 */
export async function createReworkStep(command: CreateDerivedStepCommand) {
  await assertPermission(command.actor, 'rework.create');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await loadNcrOrThrow(tx, command.nonConformanceId);
    assertTransition(ncr.status, 'REWORK');

    const instance = await createDerivedWorkStep(tx, {
      actor: command.actor,
      ncr,
      stepKind: 'REWORK',
    });

    const updated = await tx.nonConformance.update({
      where: { id: ncr.id },
      data: { status: 'REWORK', dispositionType: 'REWORK', version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'non_conformance.rework_created',
      resourceType: 'non_conformance',
      resourceId: ncr.id,
      actorId: command.actor.userId,
      previousValues: { status: ncr.status },
      newValues: { status: updated.status, reworkWorkStepInstanceId: instance.id },
      source: 'web',
    });

    return { nonConformance: updated, workStepInstanceId: instance.id };
  });
}

/** Creates the reinspection step that verifies the rework. Executed by an
 *  INSPECTOR — startWorkStep requires `reinspection.execute` for this step
 *  kind, which only that role holds (docs/04). */
export async function createReinspectionStep(command: CreateDerivedStepCommand) {
  await assertPermission(command.actor, 'ncr.assess');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await loadNcrOrThrow(tx, command.nonConformanceId);
    if (ncr.status !== 'REINSPECTION') {
      throw new InvalidStateTransitionError('Abweichung', ncr.status, 'REINSPECTION');
    }

    const instance = await createDerivedWorkStep(tx, {
      actor: command.actor,
      ncr,
      stepKind: 'REINSPECTION',
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'non_conformance.reinspection_created',
      resourceType: 'non_conformance',
      resourceId: ncr.id,
      actorId: command.actor.userId,
      newValues: { reinspectionWorkStepInstanceId: instance.id },
      source: 'web',
    });

    return { nonConformance: ncr, workStepInstanceId: instance.id };
  });
}

async function createDerivedWorkStep(
  tx: Prisma.TransactionClient,
  params: {
    actor: Actor;
    ncr: {
      id: string;
      ncrNumber: string;
      workStepInstanceId: string | null;
      productionOrderId: string;
    };
    stepKind: 'REWORK' | 'REINSPECTION';
  },
) {
  if (!params.ncr.workStepInstanceId) {
    throw new ValidationError(
      'Diese Abweichung ist keinem Arbeitsschritt zugeordnet — Nacharbeit kann nicht erzeugt werden.',
    );
  }

  const origin = await tx.workStepInstance.findFirstOrThrow({
    where: { id: params.ncr.workStepInstanceId },
    select: { id: true, planStepId: true, stepNumber: true, productionOrderId: true },
  });

  const latestAttempt = await tx.workStepInstance.aggregate({
    where: { productionOrderId: origin.productionOrderId, planStepId: origin.planStepId },
    _max: { attemptNumber: true },
  });

  const created = await tx.workStepInstance.create({
    data: {
      organizationId: params.actor.organizationId,
      productionOrderId: origin.productionOrderId,
      planStepId: origin.planStepId,
      stepNumber: origin.stepNumber,
      stepKind: params.stepKind,
      attemptNumber: (latestAttempt._max.attemptNumber ?? 1) + 1,
      originWorkStepInstanceId: origin.id,
      nonConformanceId: params.ncr.id,
      status: 'LOCKED',
    },
  });

  await writeAuditEvent(tx, {
    organizationId: params.actor.organizationId,
    eventType:
      params.stepKind === 'REWORK' ? 'work_step.rework_created' : 'work_step.reinspection_created',
    resourceType: 'work_step_instance',
    resourceId: created.id,
    actorId: params.actor.userId,
    newValues: {
      stepKind: params.stepKind,
      attemptNumber: created.attemptNumber,
      originWorkStepInstanceId: origin.id,
      nonConformanceId: params.ncr.id,
    },
    source: 'web',
  });

  await releaseWorkStepInstance(tx, {
    organizationId: params.actor.organizationId,
    workStepInstanceId: created.id,
    releasedById: params.actor.userId,
  });

  return created;
}

/**
 * Called by completion validation when a REWORK or REINSPECTION step
 * completes — the NCR follows its own machine as the derived steps finish
 * (docs/03 §5: REWORK → REINSPECTION → AWAITING_DISPOSITION).
 */
export async function advanceNonConformanceAfterDerivedStep(
  tx: Prisma.TransactionClient,
  params: { actor: Actor; nonConformanceId: string; stepKind: string },
): Promise<void> {
  const ncr = await loadNcrOrThrow(tx, params.nonConformanceId);
  const next: NonConformanceStatus | null =
    params.stepKind === 'REWORK'
      ? 'REINSPECTION'
      : params.stepKind === 'REINSPECTION'
        ? 'AWAITING_DISPOSITION'
        : null;
  if (!next || !isValidNonConformanceTransition(ncr.status as NonConformanceStatus, next)) return;

  await tx.nonConformance.update({
    where: { id: ncr.id },
    data: { status: next, version: { increment: 1 } },
  });

  await writeAuditEvent(tx, {
    organizationId: params.actor.organizationId,
    eventType:
      next === 'REINSPECTION' ? 'non_conformance.rework_completed' : 'non_conformance.reinspected',
    resourceType: 'non_conformance',
    resourceId: ncr.id,
    actorId: params.actor.userId,
    previousValues: { status: ncr.status },
    newValues: { status: next },
    source: 'system',
  });
}

export interface DisposeNonConformanceCommand {
  actor: Actor;
  nonConformanceId: string;
  dispositionType: DispositionType;
  dispositionReason: string;
}

/**
 * The QM decision that ends the NCR (docs/07 C2). CONCESSION and SCRAP
 * close it; REWORK sends it back into another rework round instead of
 * closing. Closing is what lifts the hold and lets the plan continue —
 * which is the second half of Abnahmeszenario D.
 */
export async function disposeNonConformance(command: DisposeNonConformanceCommand) {
  await assertPermission(command.actor, 'ncr.disposition');

  if (!command.dispositionReason.trim()) {
    throw new ValidationError('Eine Disposition erfordert eine Begründung.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await loadNcrOrThrow(tx, command.nonConformanceId);
    const target: NonConformanceStatus = command.dispositionType === 'REWORK' ? 'REWORK' : 'CLOSED';
    assertTransition(ncr.status, target);

    if (target === 'REWORK') {
      const instance = await createDerivedWorkStep(tx, {
        actor: command.actor,
        ncr,
        stepKind: 'REWORK',
      });
      const updated = await tx.nonConformance.update({
        where: { id: ncr.id },
        data: {
          status: 'REWORK',
          dispositionType: command.dispositionType,
          dispositionReason: command.dispositionReason,
          dispositionById: command.actor.userId,
          dispositionAt: new Date(),
          version: { increment: 1 },
        },
      });
      await writeAuditEvent(tx, {
        organizationId: command.actor.organizationId,
        eventType: 'non_conformance.disposed',
        resourceType: 'non_conformance',
        resourceId: ncr.id,
        actorId: command.actor.userId,
        previousValues: { status: ncr.status },
        newValues: {
          status: updated.status,
          dispositionType: command.dispositionType,
          reworkWorkStepInstanceId: instance.id,
        },
        reason: command.dispositionReason,
        source: 'web',
      });
      return updated;
    }

    const updated = await tx.nonConformance.update({
      where: { id: ncr.id },
      data: {
        status: 'CLOSED',
        dispositionType: command.dispositionType,
        dispositionReason: command.dispositionReason,
        dispositionById: command.actor.userId,
        dispositionAt: new Date(),
        closedAt: new Date(),
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'non_conformance.closed',
      resourceType: 'non_conformance',
      resourceId: ncr.id,
      actorId: command.actor.userId,
      previousValues: { status: ncr.status },
      newValues: { status: 'CLOSED', dispositionType: command.dispositionType },
      reason: command.dispositionReason,
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'non_conformance',
      aggregateId: ncr.id,
      eventType: 'non_conformance.closed',
      payload: { ncrId: ncr.id, disposition: command.dispositionType },
    });

    if (ncr.isBlocking) {
      await liftBlockingConsequences(tx, {
        actor: command.actor,
        nonConformanceId: ncr.id,
        productionOrderId: ncr.productionOrderId,
        reason: `NCR ${ncr.ncrNumber} abgeschlossen (${command.dispositionType}): ${command.dispositionReason}`,
      });
    }

    return updated;
  });
}

/**
 * Lifts everything a blocking NCR imposed: its holds, the order's
 * QUALITY_BLOCKED status, and — only now — the successors of the affected
 * plan step, provided its latest attempt actually completed.
 */
async function liftBlockingConsequences(
  tx: Prisma.TransactionClient,
  params: {
    actor: Actor;
    nonConformanceId: string;
    productionOrderId: string;
    reason: string;
  },
): Promise<void> {
  const holds = await tx.productionHold.findMany({
    where: { nonConformanceId: params.nonConformanceId, isActive: true },
    select: { id: true },
  });
  for (const hold of holds) {
    await releaseProductionHoldWithin(tx, {
      actor: params.actor,
      productionHoldId: hold.id,
      releaseReason: params.reason,
    });
  }

  const order = await tx.productionOrder.findFirstOrThrow({
    where: { id: params.productionOrderId },
    select: { id: true, status: true },
  });
  if (isValidProductionOrderTransition(order.status as ProductionOrderStatus, 'IN_PROGRESS')) {
    await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: 'IN_PROGRESS', version: { increment: 1 } },
    });
    await writeAuditEvent(tx, {
      organizationId: params.actor.organizationId,
      eventType: 'production_order.status_changed',
      resourceType: 'production_order',
      resourceId: order.id,
      actorId: params.actor.userId,
      previousValues: { status: order.status },
      newValues: { status: 'IN_PROGRESS' },
      reason: params.reason,
      source: 'system',
    });
  }

  const ncr = await loadNcrOrThrow(tx, params.nonConformanceId);
  if (!ncr.workStepInstanceId) return;

  const origin = await tx.workStepInstance.findFirstOrThrow({
    where: { id: ncr.workStepInstanceId },
    select: { planStepId: true, productionOrderId: true },
  });
  const latest = await tx.workStepInstance.findFirst({
    where: { productionOrderId: origin.productionOrderId, planStepId: origin.planStepId },
    orderBy: { attemptNumber: 'desc' },
    select: { id: true, status: true },
  });
  if (latest && countsAsPredecessorSatisfied(latest.status as WorkStepStatus)) {
    await releaseEligibleSuccessors(tx, {
      organizationId: params.actor.organizationId,
      completedWorkStepInstanceId: latest.id,
      releasedById: params.actor.userId,
    });
  }
}

export interface CancelNonConformanceCommand {
  actor: Actor;
  nonConformanceId: string;
  reason: string;
}

export async function cancelNonConformance(command: CancelNonConformanceCommand) {
  await assertPermission(command.actor, 'ncr.disposition');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await loadNcrOrThrow(tx, command.nonConformanceId);
    assertTransition(ncr.status, 'CANCELLED');

    const updated = await tx.nonConformance.update({
      where: { id: ncr.id },
      data: { status: 'CANCELLED', closedAt: new Date(), version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'non_conformance.cancelled',
      resourceType: 'non_conformance',
      resourceId: ncr.id,
      actorId: command.actor.userId,
      previousValues: { status: ncr.status },
      newValues: { status: 'CANCELLED' },
      reason: command.reason,
      source: 'web',
    });

    if (ncr.isBlocking) {
      await liftBlockingConsequences(tx, {
        actor: command.actor,
        nonConformanceId: ncr.id,
        productionOrderId: ncr.productionOrderId,
        reason: `NCR ${ncr.ncrNumber} storniert: ${command.reason}`,
      });
    }

    return updated;
  });
}
