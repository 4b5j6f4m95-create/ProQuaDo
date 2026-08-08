import type { Prisma } from '@prisma/client';
import { NotFoundError, OrderOnHoldError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { assertAssignedToOrder } from '@/domain/production-orders/order-access';
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

  await assertAssignedToOrder(tx, actor, instance.productionOrderId);

  if (!isOrderExecutable(instance.productionOrder.status as ProductionOrderStatus)) {
    throw new OrderOnHoldError(instance.productionOrder.status);
  }
  if (!acceptsEvidence(instance.status as WorkStepStatus)) {
    throw new ValidationError(
      `Nachweise können nur zu einem laufenden Arbeitsschritt erfasst werden (Status: ${instance.status}).`,
    );
  }

  return instance;
}
