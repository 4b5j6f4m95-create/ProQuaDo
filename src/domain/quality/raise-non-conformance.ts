import { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from '@/domain/production-orders/production-order-status';
import {
  isValidWorkStepTransition,
  type WorkStepStatus,
} from '@/domain/execution/work-step-status';
import { applyProductionHoldWithin } from './production-holds';
import { classifyBlocking } from './ncr-status';

export interface RaiseNonConformanceCommand {
  actor: Actor;
  productionOrderId: string;
  workStepInstanceId?: string;
  inspectionCharacteristicId?: string;
  description: string;
  errorCategory?: string;
  discoveredLocation?: string;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  /** The reporter may flag something as blocking; they may never flag it as
   *  non-blocking. Lowering the classification is a QM assessment
   *  (assessNonConformance), with a reason. */
  reporterSuggestsBlocking?: boolean;
  discoveredAt?: Date;
  deviceId?: string;
}

/**
 * "Abweichung melden" (docs/07 A9) — the entry point into the quality
 * process. A worker can raise one from a step; QM/PL/PM can raise one
 * against an order.
 *
 * Two things happen server-side and cannot be influenced by the client:
 * the blocking classification (see classifyBlocking) and, if it is
 * blocking, the hold plus the BLOCKED transition of the affected step. That
 * is what makes Negativtest #10 hold — the successor never becomes
 * startable while this NCR is open.
 */
export async function raiseNonConformance(command: RaiseNonConformanceCommand) {
  await assertPermission(command.actor, 'ncr.create');

  if (!command.description.trim()) {
    throw new ValidationError('Eine Abweichungsmeldung benötigt eine Beschreibung.');
  }

  // The NCR number is derived from a count, so two concurrent reports can
  // pick the same one; the unique index catches it and we simply try again
  // with the next number rather than failing the report.
  return withRetryOnNumberCollision(() =>
    withOrgContext(command.actor.organizationId, (tx) => raiseNonConformanceWithin(tx, command)),
  );
}

/** Transaction-scoped variant — used by completion validation to raise the
 *  NCR for an out-of-tolerance measurement in the same transaction that
 *  rejects the completion (Abnahmeszenario D). */
export async function raiseNonConformanceWithin(
  tx: Prisma.TransactionClient,
  command: RaiseNonConformanceCommand,
) {
  const order = await tx.productionOrder.findFirst({
    where: { id: command.productionOrderId },
    select: {
      id: true,
      status: true,
      projectId: true,
      productId: true,
      batchNumber: true,
      serialNumber: true,
    },
  });
  if (!order) throw new NotFoundError('Produktionsauftrag');

  // Idempotency for the automatic tolerance NCR: one open NCR per step and
  // characteristic, enforced by a partial unique index as well.
  if (command.workStepInstanceId && command.inspectionCharacteristicId) {
    const existing = await tx.nonConformance.findFirst({
      where: {
        workStepInstanceId: command.workStepInstanceId,
        inspectionCharacteristicId: command.inspectionCharacteristicId,
        status: { notIn: ['CLOSED', 'CANCELLED'] },
      },
    });
    if (existing) return existing;
  }

  const priority = command.priority ?? 'MEDIUM';
  const isBlocking = classifyBlocking({
    errorCategory: command.errorCategory,
    priority,
    reporterSuggestsBlocking: command.reporterSuggestsBlocking,
  });

  const ncr = await tx.nonConformance.create({
    data: {
      organizationId: command.actor.organizationId,
      ncrNumber: await nextNcrNumber(tx, command.actor.organizationId),
      projectId: order.projectId,
      productionOrderId: order.id,
      productId: order.productId,
      workStepInstanceId: command.workStepInstanceId,
      inspectionCharacteristicId: command.inspectionCharacteristicId,
      batchNumber: order.batchNumber,
      serialNumber: order.serialNumber,
      description: command.description,
      errorCategory: command.errorCategory,
      discoveredLocation: command.discoveredLocation,
      discoveredAt: command.discoveredAt ?? new Date(),
      discoveredById: command.actor.userId,
      priority,
      status: 'OPEN',
      isBlocking,
    },
  });

  await writeAuditEvent(tx, {
    organizationId: command.actor.organizationId,
    eventType: 'non_conformance.raised',
    resourceType: 'non_conformance',
    resourceId: ncr.id,
    actorId: command.actor.userId,
    newValues: {
      ncrNumber: ncr.ncrNumber,
      productionOrderId: order.id,
      workStepInstanceId: command.workStepInstanceId,
      isBlocking,
      priority,
      errorCategory: command.errorCategory,
    },
    deviceId: command.deviceId,
    source: command.deviceId ? 'mobile' : 'web',
  });

  await writeOutboxEvent(tx, {
    organizationId: command.actor.organizationId,
    aggregateType: 'non_conformance',
    aggregateId: ncr.id,
    eventType: 'non_conformance.raised',
    payload: {
      ncrId: ncr.id,
      blocking: isBlocking,
      affectedStepId: command.workStepInstanceId ?? null,
    },
  });

  if (isBlocking) {
    await applyBlockingConsequences(tx, {
      actor: command.actor,
      ncrId: ncr.id,
      ncrNumber: ncr.ncrNumber,
      productionOrderId: order.id,
      orderStatus: order.status,
      workStepInstanceId: command.workStepInstanceId,
      reason: `NCR ${ncr.ncrNumber}: ${command.description}`,
    });
  }

  return ncr;
}

/**
 * The three consequences of a blocking NCR, applied atomically: the step is
 * BLOCKED, the order is QUALITY_BLOCKED, and a hold records why. Each is
 * checked for validity first so that raising an NCR against an already
 * blocked order does not produce an invalid transition.
 */
export async function applyBlockingConsequences(
  tx: Prisma.TransactionClient,
  params: {
    actor: Actor;
    ncrId: string;
    ncrNumber: string;
    productionOrderId: string;
    orderStatus: string;
    workStepInstanceId?: string;
    reason: string;
  },
): Promise<void> {
  if (params.workStepInstanceId) {
    const step = await tx.workStepInstance.findFirst({
      where: { id: params.workStepInstanceId },
      select: { id: true, status: true },
    });
    if (step && isValidWorkStepTransition(step.status as WorkStepStatus, 'BLOCKED')) {
      await tx.workStepInstance.update({
        where: { id: step.id },
        data: { status: 'BLOCKED', version: { increment: 1 } },
      });
      await writeAuditEvent(tx, {
        organizationId: params.actor.organizationId,
        eventType: 'work_step.blocked',
        resourceType: 'work_step_instance',
        resourceId: step.id,
        actorId: params.actor.userId,
        previousValues: { status: step.status },
        newValues: { status: 'BLOCKED', nonConformanceId: params.ncrId },
        reason: params.reason,
        source: 'system',
      });
    }
  }

  if (
    isValidProductionOrderTransition(params.orderStatus as ProductionOrderStatus, 'QUALITY_BLOCKED')
  ) {
    await tx.productionOrder.update({
      where: { id: params.productionOrderId },
      data: { status: 'QUALITY_BLOCKED', version: { increment: 1 } },
    });
    await writeAuditEvent(tx, {
      organizationId: params.actor.organizationId,
      eventType: 'production_order.status_changed',
      resourceType: 'production_order',
      resourceId: params.productionOrderId,
      actorId: params.actor.userId,
      previousValues: { status: params.orderStatus },
      newValues: { status: 'QUALITY_BLOCKED', nonConformanceId: params.ncrId },
      reason: params.reason,
      source: 'system',
    });
  }

  await applyProductionHoldWithin(tx, {
    actor: params.actor,
    scopeType: params.workStepInstanceId ? 'WORK_STEP' : 'ORDER',
    productionOrderId: params.productionOrderId,
    workStepInstanceId: params.workStepInstanceId,
    nonConformanceId: params.ncrId,
    holdReason: params.reason,
    releaseCondition: `Abschluss von ${params.ncrNumber} (Nacharbeit, Nachprüfung und Disposition)`,
  });
}

async function nextNcrNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `NCR-${year}-`;
  const count = await tx.nonConformance.count({
    where: { organizationId, ncrNumber: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

async function withRetryOnNumberCollision<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isNumberCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        String(error.meta?.target ?? '').includes('ncr_number');
      if (!isNumberCollision) throw error;
    }
  }
  throw new ValidationError(
    'Die Abweichungsnummer konnte nicht eindeutig vergeben werden — bitte erneut versuchen.',
  );
}
