import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import { confirmWithPin } from '@/domain/identity/confirm-with-pin';
import type { Actor } from '@/domain/shared/actor';

/**
 * Produktfreigabe — Masterprompt Kap. 10 "Endprüfung und Produktfreigabe".
 *
 * Section 9 of the dossier used to add up whether the order was finished and
 * whether anything was still open, and then said, in as many words, that the
 * release itself was not recorded anywhere. That was the honest thing to do
 * while no decision existed; it was not a substitute for one. "Nothing is
 * open" is a property of the data. "This product may ship" is a judgement a
 * person makes, and an audit asks who made it, when, on what basis, and why.
 *
 * Three properties this service exists to guarantee:
 *
 *  1. **A release is never derived.** The server refuses to record one unless
 *     the order is COMPLETED with no open blocking NCR and no active hold —
 *     but meeting those conditions does not produce a release, it only makes
 *     one possible.
 *  2. **The basis is copied, not recomputed.** What the deciding person saw
 *     is stored on the row. The same reasoning as measurement tolerances: a
 *     later change to the data must not silently rewrite the grounds of a
 *     decision that was already made.
 *  3. **Nothing is overwritten.** Decisions accumulate. A rejection stays
 *     readable after the rework that answered it, and the database permits at
 *     most one RELEASED row per order.
 */

export const PRODUCT_RELEASE_TEXT_VERSION = '1.0';
export const PRODUCT_RELEASE_CONFIRMATION_TEXT =
  'Ich bestätige, dass ich die Produktionsakte dieses Auftrags geprüft habe und die ' +
  'Produktfreigabe auf dieser Grundlage verantworte. Offene Abweichungen und Sperren sind mir ' +
  'bekannt und in der Begründung berücksichtigt.';

export type ProductReleaseDecision = 'RELEASED' | 'REJECTED';

export interface DecideProductReleaseCommand {
  actor: Actor;
  productionOrderId: string;
  decision: ProductReleaseDecision;
  /** Required for both outcomes — see the CHECK constraint on the table for
   *  why a release needs one just as much as a rejection does. */
  reason: string;
  /** Re-authentication for a critical action (docs/04, ADR-005). */
  pin: string;
}

export interface ProductReleaseBasis {
  orderStatus: string;
  openBlockingNonConformances: number;
  activeHolds: number;
  completedSteps: number;
  totalSteps: number;
}

export interface ProductReleaseResult {
  productReleaseId: string;
  decision: ProductReleaseDecision;
  decidedAt: Date;
  basis: ProductReleaseBasis;
}

export async function decideProductRelease(
  command: DecideProductReleaseCommand,
): Promise<ProductReleaseResult> {
  await assertPermission(command.actor, 'product_release.decide');

  if (!command.reason.trim()) {
    throw new ValidationError('Eine Produktfreigabe-Entscheidung erfordert eine Begründung.');
  }

  // Verified before the transaction and never inside it: scrypt is slow by
  // design, and the plaintext must not travel further than it has to (ADR-005).
  await confirmWithPin(command.actor, command.pin, { purpose: 'product_release.decision' });

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const order = await tx.productionOrder.findFirst({
      where: { id: command.productionOrderId },
      select: { id: true, status: true, orderNumber: true, serialNumber: true },
    });
    if (!order) throw new NotFoundError('Produktionsauftrag');

    const existingRelease = await tx.productRelease.findFirst({
      where: { productionOrderId: order.id, decision: 'RELEASED' },
      select: { id: true, decidedAt: true },
    });
    if (existingRelease) {
      // Both outcomes are refused, and the second one matters more: withdrawing
      // a release that has already been given is a recall, not a correction,
      // and it is not this service's job to make one look like the other.
      throw new ValidationError(
        `Dieser Auftrag wurde am ${existingRelease.decidedAt.toLocaleDateString('de-DE')} bereits freigegeben. ` +
          'Eine Rücknahme ist keine erneute Entscheidung und über diesen Weg nicht möglich.',
      );
    }

    const basis = await readBasis(tx, order.id, order.status);

    if (command.decision === 'RELEASED') {
      const blockers = describeBlockers(basis);
      if (blockers.length > 0) {
        throw new ValidationError(
          `Produktfreigabe nicht möglich: ${blockers.join('; ')}. Eine Ablehnung ist jederzeit möglich.`,
        );
      }
    }

    const decidedAt = new Date();
    const release = await tx.productRelease.create({
      data: {
        organizationId: command.actor.organizationId,
        productionOrderId: order.id,
        decision: command.decision,
        decidedById: command.actor.userId,
        decidedAt,
        reason: command.reason.trim(),
        basisOrderStatus: basis.orderStatus,
        basisOpenBlockingNcrs: basis.openBlockingNonConformances,
        basisActiveHolds: basis.activeHolds,
        basisCompletedSteps: basis.completedSteps,
        basisTotalSteps: basis.totalSteps,
        confirmationText: PRODUCT_RELEASE_CONFIRMATION_TEXT,
        confirmationTextVersion: PRODUCT_RELEASE_TEXT_VERSION,
        signatureData: buildReleaseDigest({
          userId: command.actor.userId,
          productionOrderId: order.id,
          decision: command.decision,
          decidedAt,
        }),
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType:
        command.decision === 'RELEASED' ? 'product_release.granted' : 'product_release.refused',
      resourceType: 'production_order',
      resourceId: order.id,
      actorId: command.actor.userId,
      newValues: {
        productReleaseId: release.id,
        decision: command.decision,
        serialNumber: order.serialNumber,
        basis,
      },
      reason: command.reason.trim(),
      result: command.decision === 'RELEASED' ? 'SUCCESS' : 'PARTIAL',
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'production_order',
      aggregateId: order.id,
      eventType:
        command.decision === 'RELEASED' ? 'product_release.granted' : 'product_release.refused',
      payload: {
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        decision: command.decision,
      },
    });

    return {
      productReleaseId: release.id,
      decision: command.decision,
      decidedAt,
      basis,
    };
  });
}

/**
 * The decision in force for an order, or null. The latest row wins; a
 * RELEASED row can only be the latest, because nothing may follow it.
 */
export async function getProductRelease(actor: Actor, productionOrderId: string) {
  await assertPermission(actor, 'product_release.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.productRelease.findFirst({
      where: { productionOrderId },
      orderBy: { decidedAt: 'desc' },
    }),
  );
}

/** Same question, inside a caller's transaction — used by the dossier, which
 *  reads everything else at the same instant (`data_as_of`). */
export async function getProductReleaseWithin(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
) {
  return tx.productRelease.findFirst({
    where: { productionOrderId },
    orderBy: { decidedAt: 'desc' },
  });
}

async function readBasis(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
  orderStatus: string,
): Promise<ProductReleaseBasis> {
  const [openBlocking, activeHolds, instances] = await Promise.all([
    tx.nonConformance.count({
      where: {
        productionOrderId,
        isBlocking: true,
        status: { notIn: ['CLOSED', 'CANCELLED'] },
      },
    }),
    tx.productionHold.count({ where: { productionOrderId, isActive: true } }),
    tx.workStepInstance.findMany({
      where: { productionOrderId },
      select: { planStepId: true, status: true, attemptNumber: true },
    }),
  ]);

  // Only the latest attempt per plan step counts — the same rule as
  // releaseEligibleSuccessors and the dashboard, so the three cannot
  // contradict each other about how far an order got.
  const latestByPlanStep = new Map<string, { status: string; attemptNumber: number }>();
  for (const instance of instances) {
    const current = latestByPlanStep.get(instance.planStepId);
    if (!current || instance.attemptNumber > current.attemptNumber) {
      latestByPlanStep.set(instance.planStepId, instance);
    }
  }
  const latest = [...latestByPlanStep.values()];

  return {
    orderStatus,
    openBlockingNonConformances: openBlocking,
    activeHolds,
    completedSteps: latest.filter((i) => i.status === 'COMPLETED' || i.status === 'SKIPPED').length,
    totalSteps: latest.length,
  };
}

/** What still stands in the way, in words a person can act on rather than a
 *  boolean they have to interpret (docs/07: a block names its cause). */
export function describeBlockers(basis: ProductReleaseBasis): string[] {
  const blockers: string[] = [];
  if (basis.orderStatus !== 'COMPLETED') {
    blockers.push(`der Auftrag ist nicht abgeschlossen (Status ${basis.orderStatus})`);
  }
  if (basis.openBlockingNonConformances > 0) {
    blockers.push(
      `${basis.openBlockingNonConformances} blockierende Abweichung(en) sind noch offen`,
    );
  }
  if (basis.activeHolds > 0) {
    blockers.push(`${basis.activeHolds} Sperre(n) sind aktiv`);
  }
  return blockers;
}

/** See ADR-005 on what this digest is and, more importantly, what it is not. */
function buildReleaseDigest(params: {
  userId: string;
  productionOrderId: string;
  decision: string;
  decidedAt: Date;
}): string {
  return createHash('sha256')
    .update(
      [
        params.userId,
        params.productionOrderId,
        params.decision,
        PRODUCT_RELEASE_TEXT_VERSION,
        params.decidedAt.toISOString(),
      ].join('|'),
    )
    .digest('hex');
}
