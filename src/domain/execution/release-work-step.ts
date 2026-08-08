import type { Prisma } from '@prisma/client';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import {
  hashIdSet,
  hashTokenSignature,
  issueReleaseToken,
  newTokenNonce,
  type ReleaseTokenPayload,
} from '@/lib/security/release-token';
import { hasOpenBlockingNonConformance } from '@/domain/quality/production-holds';
import { countsAsPredecessorSatisfied, type WorkStepStatus } from './work-step-status';

/**
 * Server-side work step release — the ONLY place a work step instance
 * becomes startable. Everything here runs inside a caller-provided
 * transaction so that "step released" and "audit event written" are one
 * atomic fact (docs/03 "Implementation Guidelines").
 *
 * Two callers, one code path: releasing the entry steps when an order is
 * released, and releasing successors after a predecessor completes. There
 * is deliberately no third path — no admin override, no import, no client
 * request can produce a release (MASTERPROMPT.md Kap. 24).
 */

const RELEASE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days offline grace

export interface ReleasedWorkStep {
  workStepInstanceId: string;
  stepNumber: number;
  /** The signed token, returned ONCE at release time — the server keeps
   *  only its hash. Phase 5's sync API hands this to the device so it can
   *  prove the release while offline; the online UI ignores it and the
   *  server checks the persisted release row instead. */
  releaseToken: string;
}

export async function releaseWorkStepInstance(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    workStepInstanceId: string;
    releasedById: string;
    correlationId?: string;
  },
): Promise<ReleasedWorkStep> {
  const instance = await tx.workStepInstance.findFirstOrThrow({
    where: { id: params.workStepInstanceId },
    include: {
      productionOrder: { select: { id: true, productionPlanRevisionId: true } },
      planStep: {
        select: {
          id: true,
          photoRequired: true,
          signatureRequired: true,
          fourEyesRequired: true,
          checklistItems: { select: { id: true } },
          photoRequirements: { select: { id: true } },
          inspectionCharacteristics: { select: { id: true } },
          documentBindings: { select: { documentRevisionId: true } },
        },
      },
    },
  });

  const requirementsHash = hashIdSet([
    ...instance.planStep.checklistItems.map((i) => `checklist:${i.id}`),
    ...instance.planStep.photoRequirements.map((r) => `photo:${r.id}`),
    ...instance.planStep.inspectionCharacteristics.map((c) => `measurement:${c.id}`),
    `flags:${instance.planStep.photoRequired}:${instance.planStep.signatureRequired}:${instance.planStep.fourEyesRequired}`,
  ]);
  const documentSetHash = hashIdSet(
    instance.planStep.documentBindings.map((b) => b.documentRevisionId),
  );

  const releasedAt = new Date();
  const validUntil = new Date(releasedAt.getTime() + RELEASE_TOKEN_TTL_MS);
  const payload: ReleaseTokenPayload = {
    workStepInstanceId: instance.id,
    productionOrderId: instance.productionOrderId,
    organizationId: params.organizationId,
    releasedAt: releasedAt.toISOString(),
    issuingSystemInstance: process.env.SERVER_NODE_ID ?? 'unknown',
    planRevisionId: instance.productionOrder.productionPlanRevisionId,
    requirementsHash,
    documentSetHash,
    entityVersion: instance.version,
    tokenId: newTokenNonce(),
    validUntil: validUntil.toISOString(),
  };
  const token = issueReleaseToken(payload);

  // Upsert, not create: a step can legitimately be re-released (e.g. after
  // a revision conflict was resolved in Phase 5). The previous token's hash
  // is overwritten, which invalidates it — exactly the intent.
  await tx.workStepRelease.upsert({
    where: { workStepInstanceId: instance.id },
    create: {
      organizationId: params.organizationId,
      workStepInstanceId: instance.id,
      releasedById: params.releasedById,
      releasedAt,
      tokenHash: hashTokenSignature(token.signature),
      tokenNonce: payload.tokenId,
      validUntil,
      planRevisionHash: hashIdSet([payload.planRevisionId]),
      documentSetHash,
      requirementsHash,
      isValid: true,
    },
    update: {
      releasedById: params.releasedById,
      releasedAt,
      tokenHash: hashTokenSignature(token.signature),
      tokenNonce: payload.tokenId,
      validUntil,
      planRevisionHash: hashIdSet([payload.planRevisionId]),
      documentSetHash,
      requirementsHash,
      isValid: true,
    },
  });

  const updated = await tx.workStepInstance.update({
    where: { id: instance.id },
    data: { status: 'READY', version: { increment: 1 } },
  });

  await writeAuditEvent(tx, {
    organizationId: params.organizationId,
    eventType: 'work_step.released',
    resourceType: 'work_step_instance',
    resourceId: instance.id,
    actorId: params.releasedById,
    correlationId: params.correlationId,
    previousValues: { status: instance.status },
    newValues: { status: updated.status, releaseTokenNonce: payload.tokenId },
    source: 'system',
  });

  await writeOutboxEvent(tx, {
    organizationId: params.organizationId,
    aggregateType: 'work_step_instance',
    aggregateId: instance.id,
    eventType: 'work_step.released',
    payload: {
      productionOrderId: instance.productionOrderId,
      stepNumber: instance.stepNumber,
      releaseTokenNonce: payload.tokenId,
    },
  });

  return {
    workStepInstanceId: instance.id,
    stepNumber: instance.stepNumber,
    releaseToken: token.encoded,
  };
}

/**
 * After a step reaches COMPLETED (or SKIPPED), releases every LOCKED
 * successor whose predecessors are ALL satisfied. This is the second half
 * of the central invariant: the successor becomes startable here, on the
 * server, after validation — never on the device, and never as a side
 * effect of a local completion (docs/06 "Die zentrale Invariante",
 * Negativtest #1).
 */
export async function releaseEligibleSuccessors(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    completedWorkStepInstanceId: string;
    releasedById: string;
    correlationId?: string;
  },
): Promise<ReleasedWorkStep[]> {
  const completed = await tx.workStepInstance.findFirstOrThrow({
    where: { id: params.completedWorkStepInstanceId },
    include: { planStep: { select: { successorLinks: { select: { dependentStepId: true } } } } },
  });

  // Nothing downstream opens while quality still has the order (Negativtest
  // #10). The check is here rather than only in startWorkStep so that a
  // successor is not even shown as READY while a blocking NCR is open.
  if (await hasOpenBlockingNonConformance(tx, completed.productionOrderId)) return [];

  const successorPlanStepIds = completed.planStep.successorLinks.map((l) => l.dependentStepId);
  if (successorPlanStepIds.length === 0) return [];

  const successors = await tx.workStepInstance.findMany({
    where: {
      productionOrderId: completed.productionOrderId,
      planStepId: { in: successorPlanStepIds },
      status: 'LOCKED',
      // Rework and reinspection steps are released by the NCR workflow, not
      // by the plan graph — they are not "the next step of the plan".
      stepKind: 'PRODUCTION',
    },
    include: {
      planStep: { select: { predecessorLinks: { select: { predecessorStepId: true } } } },
    },
  });

  const released: ReleasedWorkStep[] = [];
  for (const successor of successors) {
    const predecessorPlanStepIds = successor.planStep.predecessorLinks.map(
      (l) => l.predecessorStepId,
    );
    const predecessorInstances = await tx.workStepInstance.findMany({
      where: {
        productionOrderId: completed.productionOrderId,
        planStepId: { in: predecessorPlanStepIds },
      },
      select: { planStepId: true, status: true, attemptNumber: true },
    });

    // A plan step can have several instances since Phase 4: the failed
    // original plus its rework/reinspection attempts. Only the LATEST
    // attempt decides whether the predecessor is done — the failed original
    // stays in the history as BLOCKED and must not veto forever, and an old
    // COMPLETED attempt must not outvote a newer failed one.
    const latestByPlanStep = new Map<string, { status: string; attemptNumber: number }>();
    for (const instance of predecessorInstances) {
      const current = latestByPlanStep.get(instance.planStepId);
      if (!current || instance.attemptNumber > current.attemptNumber) {
        latestByPlanStep.set(instance.planStepId, instance);
      }
    }

    // Guard against a partially materialized order: fewer plan steps
    // represented than edges means we cannot prove all predecessors are
    // done, so we don't release. Failing closed is the only safe direction.
    const allSatisfied =
      latestByPlanStep.size === new Set(predecessorPlanStepIds).size &&
      [...latestByPlanStep.values()].every((p) =>
        countsAsPredecessorSatisfied(p.status as WorkStepStatus),
      );
    if (!allSatisfied) continue;

    released.push(
      await releaseWorkStepInstance(tx, {
        organizationId: params.organizationId,
        workStepInstanceId: successor.id,
        releasedById: params.releasedById,
        correlationId: params.correlationId,
      }),
    );
  }

  return released;
}
