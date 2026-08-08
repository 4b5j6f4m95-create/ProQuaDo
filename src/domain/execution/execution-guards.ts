import type { Prisma } from '@prisma/client';
import { NotFoundError, OrderOnHoldError, ValidationError } from '@/lib/domain-errors';
import { assertPermissionWithin } from '@/lib/authz/permission-within';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';
import type { Actor } from '@/domain/shared/actor';
import { assertAssignedToOrder } from '@/domain/production-orders/order-access';
import { assertNotBlocked } from '@/domain/quality/production-holds';
import {
  isOrderExecutable,
  type ProductionOrderStatus,
} from '@/domain/production-orders/production-order-status';
import { acceptsEvidence, type WorkStepStatus } from './work-step-status';

/**
 * The guard every evidence-capture service opens with. Factored out because
 * "may this person record something against this step right now?" has three
 * independent answers (assignment, order state, step state) and all three
 * must be asked every time — a capture endpoint that checked only one would
 * be a hole in the same wall the start/complete endpoints guard.
 */
export async function loadInstanceForEvidence(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workStepInstanceId: string,
) {
  const instance = await tx.workStepInstance.findFirst({
    where: { id: workStepInstanceId },
    include: {
      productionOrder: { select: { id: true, status: true } },
      planStep: { select: { id: true, title: true } },
    },
  });
  if (!instance) throw new NotFoundError('Arbeitsschritt');

  await assertStepKindPermission(tx, actor, instance.stepKind);
  await assertAssignedToOrder(tx, actor, instance.productionOrderId);
  await assertNotBlockedForStep(tx, instance);

  if (
    !isOrderExecutable(instance.productionOrder.status as ProductionOrderStatus) &&
    // A quality-blocked order still permits the rework and reinspection
    // that resolve the block.
    !(instance.stepKind !== 'PRODUCTION' && instance.productionOrder.status === 'QUALITY_BLOCKED')
  ) {
    throw new OrderOnHoldError(instance.productionOrder.status);
  }
  if (!acceptsEvidence(instance.status as WorkStepStatus)) {
    throw new ValidationError(
      `Nachweise können nur zu einem laufenden Arbeitsschritt erfasst werden (Status: ${instance.status}).`,
    );
  }

  return instance;
}

/**
 * Which permission a step demands depends on what kind of step it is
 * (docs/04): a WORKER executes production steps and rework, an INSPECTOR
 * the reinspection that verifies it. Asserted inside the transaction
 * because the answer is only known once the instance has been read — the
 * same reason applies to starting a step (see start-work-step.ts).
 */
export const PERMISSION_BY_STEP_KIND: Record<string, PermissionCode> = {
  PRODUCTION: 'work_step.execute',
  REWORK: 'rework.execute',
  REINSPECTION: 'reinspection.execute',
};

const STEP_KIND_DENIED_MESSAGE: Record<string, string> = {
  PRODUCTION: 'Sie besitzen nicht die Berechtigung, Arbeitsschritte auszuführen.',
  REWORK: 'Sie besitzen nicht die Berechtigung, Nacharbeit auszuführen.',
  REINSPECTION: 'Nachprüfungen dürfen nur von einer prüfberechtigten Person ausgeführt werden.',
};

export async function assertStepKindPermission(
  tx: Prisma.TransactionClient,
  actor: Actor,
  stepKind: string,
): Promise<void> {
  await assertPermissionWithin(
    tx,
    actor,
    PERMISSION_BY_STEP_KIND[stepKind] ?? 'work_step.execute',
    STEP_KIND_DENIED_MESSAGE[stepKind],
  );
}

// Completing a regular step is `work_step.complete_locally`; completing a
// rework or a reinspection is covered by the permission that allows
// performing it in the first place.
const COMPLETION_PERMISSION_BY_STEP_KIND: Record<string, PermissionCode> = {
  PRODUCTION: 'work_step.complete_locally',
  REWORK: 'rework.execute',
  REINSPECTION: 'reinspection.execute',
};

export async function assertCompletionPermission(
  tx: Prisma.TransactionClient,
  actor: Actor,
  stepKind: string,
): Promise<void> {
  await assertPermissionWithin(
    tx,
    actor,
    COMPLETION_PERMISSION_BY_STEP_KIND[stepKind] ?? 'work_step.complete_locally',
    STEP_KIND_DENIED_MESSAGE[stepKind],
  );
}

/**
 * Hold check with the one exemption that makes the quality loop possible:
 * a rework or reinspection step is not blocked by the hold of the very NCR
 * it exists to resolve. Holds freeze REGULAR production — they must not
 * freeze the repair they demand. Every other hold still applies.
 */
export async function assertNotBlockedForStep(
  tx: Prisma.TransactionClient,
  instance: {
    id: string;
    productionOrderId: string;
    stepKind: string;
    nonConformanceId: string | null;
  },
): Promise<void> {
  const exemptNonConformanceId =
    instance.stepKind === 'PRODUCTION' ? undefined : (instance.nonConformanceId ?? undefined);

  await assertNotBlocked(tx, {
    productionOrderId: instance.productionOrderId,
    workStepInstanceId: instance.id,
    exemptNonConformanceId,
  });
}
