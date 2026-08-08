import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { verifyConfirmationPin } from '@/lib/auth/confirmation-pin';
import {
  ConfirmationFailedError,
  NotFoundError,
  OrderOnHoldError,
  ValidationError,
  type EvidenceGap,
} from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { assertAssignedToOrder } from '@/domain/production-orders/order-access';
import {
  isOrderExecutable,
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from '@/domain/production-orders/production-order-status';
import { releaseEligibleSuccessors } from './release-work-step';
import { evaluateStepRequirements } from './step-requirements';
import { countsAsPredecessorSatisfied, type WorkStepStatus } from './work-step-status';

/**
 * Completion is the point where the central invariant is enforced
 * (docs/06_OFFLINE_SYNC_CONFLICT.md):
 *
 *   the client SUBMITS a completion; only the server COMPLETES it, after
 *   re-evaluating every requirement from its own data, and only then does a
 *   successor become startable.
 *
 * Nothing a client sends — no status field, no "already validated" flag —
 * is read as authority here. The submission carries evidence references and
 * a confirmation; the verdict is computed server-side (Negativtest #2).
 */

export const STEP_CONFIRMATION_TEXT_VERSION = '1.0';
export const STEP_CONFIRMATION_TEXT =
  'Ich bestätige, dass ich den Arbeitsschritt entsprechend der angezeigten Arbeitsanweisung ' +
  'und den dokumentierten Unterlagen ausgeführt habe. Abweichungen habe ich vollständig gemeldet.';

export type CompletionOutcome = 'COMPLETED' | 'REJECTED' | 'AWAITING_SECOND_APPROVAL' | 'DUPLICATE';

/** Mirrors ValidateCompletionResponse in docs/05_API_CONTRACTS.md. */
export interface CompletionResult {
  submissionId: string;
  result: CompletionOutcome;
  workStepStatus: WorkStepStatus;
  rejectionReasons: EvidenceGap[];
  /** Successors the server released as a consequence — empty unless the
   *  step actually reached COMPLETED. */
  nextStepInstanceIds: string[];
  auditEventId?: string;
}

export interface SubmitCompletionCommand {
  actor: Actor;
  workStepInstanceId: string;
  /** One key per logical completion, not per HTTP retry (docs/05). */
  idempotencyKey: string;
  confirmation: {
    signatureMethod: 'PIN' | 'DIGITAL_SIGNATURE';
    /** Verified against users.confirmation_pin_hash and then discarded —
     *  never stored, never audited. */
    pin: string;
  };
  clientCompletedAt?: Date;
  deviceId?: string;
  usedDocumentRevisionIds?: string[];
}

export async function submitWorkStepCompletion(
  command: SubmitCompletionCommand,
): Promise<CompletionResult> {
  await assertPermission(command.actor, 'work_step.complete_locally');

  // The PIN is checked before the mutating transaction and its plaintext
  // never enters it — scrypt verification is also slow enough that holding
  // a database transaction open across it would be wasteful.
  const pinIsValid = await verifyActorPin(command.actor, command.confirmation.pin);
  if (!pinIsValid) {
    throw new ConfirmationFailedError('Die eingegebene PIN ist nicht korrekt.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const duplicate = await tx.completionSubmission.findFirst({
      where: { idempotencyKey: command.idempotencyKey },
      include: { workStepInstance: { select: { status: true } } },
    });
    if (duplicate) {
      // True idempotency (docs/05 DUPLICATE_COMMAND): the original outcome
      // is returned, nothing is completed twice, no second audit event is
      // written (Negativtest #3).
      return {
        submissionId: duplicate.id,
        result: 'DUPLICATE' as const,
        workStepStatus: duplicate.workStepInstance.status as WorkStepStatus,
        rejectionReasons: parseRejectionReasons(duplicate.validationReason),
        nextStepInstanceIds: [],
      };
    }

    const instance = await tx.workStepInstance.findFirst({
      where: { id: command.workStepInstanceId },
      include: {
        productionOrder: { select: { id: true, status: true, productionPlanRevisionId: true } },
      },
    });
    if (!instance) throw new NotFoundError('Arbeitsschritt');

    await assertAssignedToOrder(tx, command.actor, instance.productionOrderId);
    if (!isOrderExecutable(instance.productionOrder.status as ProductionOrderStatus)) {
      throw new OrderOnHoldError(instance.productionOrder.status);
    }
    if (instance.status !== 'IN_PROGRESS') {
      throw new ValidationError(
        `Nur ein laufender Arbeitsschritt kann abgeschlossen werden (Status: ${instance.status}).`,
      );
    }

    const confirmedAt = command.clientCompletedAt ?? new Date();
    await tx.stepConfirmation.create({
      data: {
        organizationId: command.actor.organizationId,
        workStepInstanceId: instance.id,
        confirmedById: command.actor.userId,
        confirmationText: STEP_CONFIRMATION_TEXT,
        confirmationTextVersion: STEP_CONFIRMATION_TEXT_VERSION,
        signatureMethod: command.confirmation.signatureMethod,
        signatureData: buildSignatureDigest({
          userId: command.actor.userId,
          workStepInstanceId: instance.id,
          confirmedAt,
          method: command.confirmation.signatureMethod,
        }),
        deviceId: command.deviceId,
        confirmedAt,
      },
    });

    const submission = await tx.completionSubmission.create({
      data: {
        organizationId: command.actor.organizationId,
        workStepInstanceId: instance.id,
        idempotencyKey: command.idempotencyKey,
        submittedById: command.actor.userId,
        submittedAt: new Date(),
        clientCompletedAt: command.clientCompletedAt,
        deviceId: command.deviceId,
        status: 'PENDING_VALIDATION',
        usedPlanRevisionId: instance.productionOrder.productionPlanRevisionId,
        usedDocumentRevisionIds: command.usedDocumentRevisionIds ?? [],
      },
    });

    await tx.workStepInstance.update({
      where: { id: instance.id },
      data: { status: 'VALIDATING', version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.completion_submitted',
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: command.actor.userId,
      previousValues: { status: instance.status },
      newValues: { status: 'VALIDATING', submissionId: submission.id },
      deviceId: command.deviceId,
      clientTimestamp: command.clientCompletedAt,
      idempotencyKey: command.idempotencyKey,
      source: command.deviceId ? 'mobile' : 'web',
    });

    // Online path: validate immediately, in the same transaction, so the
    // worker gets the verdict in one round trip (docs/07 A6). The offline
    // path (Phase 5) reaches the same function via the sync API instead.
    return validateSubmissionWithin(tx, {
      organizationId: command.actor.organizationId,
      submissionId: submission.id,
      validatedById: command.actor.userId,
    });
  });
}

export interface ValidateCompletionCommand {
  actor: Actor;
  completionSubmissionId: string;
}

/**
 * The manual re-validation path: a QM/PL re-runs validation on a submission
 * that is still pending (e.g. after a hold was lifted). The automatic path
 * inside submitWorkStepCompletion() is a server action and therefore does
 * NOT check this permission — it is the server validating its own inbox,
 * not a user exercising `completion_submission.validate`.
 */
export async function validateCompletionSubmission(
  command: ValidateCompletionCommand,
): Promise<CompletionResult> {
  await assertPermission(command.actor, 'completion_submission.validate');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const submission = await tx.completionSubmission.findFirst({
      where: { id: command.completionSubmissionId },
    });
    if (!submission) throw new NotFoundError('Abschlussmeldung');
    if (submission.status !== 'PENDING_VALIDATION') {
      throw new ValidationError(
        `Diese Abschlussmeldung wurde bereits bearbeitet (Status: ${submission.status}).`,
      );
    }

    return validateSubmissionWithin(tx, {
      organizationId: command.actor.organizationId,
      submissionId: submission.id,
      validatedById: command.actor.userId,
    });
  });
}

/**
 * `validateAndCompleteWorkStep` from docs/03/10 — the authoritative gate.
 * Runs inside the caller's transaction so that verdict, status change,
 * successor release, audit and outbox events are one atomic fact.
 */
async function validateSubmissionWithin(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; submissionId: string; validatedById: string },
): Promise<CompletionResult> {
  const submission = await tx.completionSubmission.findFirstOrThrow({
    where: { id: params.submissionId },
  });
  const instance = await tx.workStepInstance.findFirstOrThrow({
    where: { id: submission.workStepInstanceId },
    include: {
      productionOrder: { select: { id: true, status: true } },
      planStep: {
        select: {
          id: true,
          photoRequired: true,
          signatureRequired: true,
          fourEyesRequired: true,
          checklistItems: {
            orderBy: { itemNumber: 'asc' },
            select: { id: true, itemNumber: true, text: true, isRequired: true },
          },
          photoRequirements: {
            select: { id: true, category: true, minCount: true, maxCount: true },
          },
          inspectionCharacteristics: {
            orderBy: { characteristicNumber: 'asc' },
            select: {
              id: true,
              characteristicNumber: true,
              name: true,
              isRequired: true,
              unit: true,
            },
          },
        },
      },
      checklistResponses: { select: { checklistItemId: true, response: true } },
      photoEvidence: {
        select: { photoRequirementId: true, photoCategory: true, uploadStatus: true },
      },
      measurementResults: {
        select: { inspectionCharacteristicId: true, isWithinTolerance: true, measuredValue: true },
      },
      confirmations: { select: { id: true } },
    },
  });

  const evaluation = evaluateStepRequirements(
    {
      photoRequired: instance.planStep.photoRequired,
      signatureRequired: instance.planStep.signatureRequired,
      fourEyesRequired: instance.planStep.fourEyesRequired,
      checklistItems: instance.planStep.checklistItems,
      photoRequirements: instance.planStep.photoRequirements,
      inspectionCharacteristics: instance.planStep.inspectionCharacteristics,
    },
    {
      checklistResponses: instance.checklistResponses,
      photos: instance.photoEvidence,
      measurements: instance.measurementResults.map((m) => ({
        inspectionCharacteristicId: m.inspectionCharacteristicId,
        isWithinTolerance: m.isWithinTolerance,
        measuredValue: m.measuredValue.toString(),
      })),
      hasConfirmation: instance.confirmations.length > 0,
    },
  );

  if (!evaluation.satisfied) {
    const reasons = [...evaluation.gaps, ...evaluation.toleranceViolations];
    // Deliberately NOT thrown: a rejection is a persisted business outcome,
    // and throwing would roll back the very record that documents it.
    await tx.completionSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'REJECTED',
        validationStatus:
          evaluation.toleranceViolations.length > 0
            ? 'MEASUREMENT_OUT_OF_TOLERANCE'
            : 'MISSING_REQUIRED_EVIDENCE',
        validationReason: JSON.stringify(reasons),
        validatedAt: new Date(),
        validatedById: params.validatedById,
        version: { increment: 1 },
      },
    });
    await tx.workStepInstance.update({
      where: { id: instance.id },
      data: { status: 'COMPLETION_REJECTED', version: { increment: 1 } },
    });

    const audit = await writeAuditEvent(tx, {
      organizationId: params.organizationId,
      eventType: 'work_step.completion_rejected',
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: params.validatedById,
      previousValues: { status: instance.status },
      newValues: { status: 'COMPLETION_REJECTED', reasons },
      result: 'FAILURE',
      failureReason: reasons.map((r) => r.code).join(','),
      idempotencyKey: submission.idempotencyKey,
      source: 'system',
    });

    await writeOutboxEvent(tx, {
      organizationId: params.organizationId,
      aggregateType: 'work_step_instance',
      aggregateId: instance.id,
      eventType: 'work_step.completion_rejected',
      payload: { submissionId: submission.id, reasons },
    });

    return {
      submissionId: submission.id,
      result: 'REJECTED',
      workStepStatus: 'COMPLETION_REJECTED',
      rejectionReasons: reasons,
      nextStepInstanceIds: [],
      auditEventId: audit.id,
    };
  }

  await tx.completionSubmission.update({
    where: { id: submission.id },
    data: {
      status: 'VALIDATED',
      validationStatus: 'OK',
      validatedAt: new Date(),
      validatedById: params.validatedById,
      version: { increment: 1 },
    },
  });

  // Four eyes: validation passed, but the step is NOT complete until an
  // independent person confirms it. Successors stay LOCKED. The deciding
  // service (releaseSecondApproval) is Phase 4 scope — docs/10_MVP_PLAN.md
  // feature 11 / Abnahmeszenario E.
  if (instance.planStep.fourEyesRequired) {
    await tx.secondApproval.upsert({
      where: { workStepInstanceId: instance.id },
      create: {
        organizationId: params.organizationId,
        workStepInstanceId: instance.id,
        executorId: submission.submittedById,
        reviewerStatus: 'PENDING',
      },
      update: { executorId: submission.submittedById, reviewerStatus: 'PENDING' },
    });
    await tx.workStepInstance.update({
      where: { id: instance.id },
      data: { status: 'AWAITING_SECOND_APPROVAL', version: { increment: 1 } },
    });

    const audit = await writeAuditEvent(tx, {
      organizationId: params.organizationId,
      eventType: 'work_step.awaiting_second_approval',
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: params.validatedById,
      previousValues: { status: instance.status },
      newValues: { status: 'AWAITING_SECOND_APPROVAL', executorId: submission.submittedById },
      idempotencyKey: submission.idempotencyKey,
      source: 'system',
    });

    return {
      submissionId: submission.id,
      result: 'AWAITING_SECOND_APPROVAL',
      workStepStatus: 'AWAITING_SECOND_APPROVAL',
      rejectionReasons: [],
      nextStepInstanceIds: [],
      auditEventId: audit.id,
    };
  }

  const completedAt = new Date();
  await tx.workStepInstance.update({
    where: { id: instance.id },
    data: { status: 'COMPLETED', completedAt, version: { increment: 1 } },
  });

  const audit = await writeAuditEvent(tx, {
    organizationId: params.organizationId,
    eventType: 'work_step.completed',
    resourceType: 'work_step_instance',
    resourceId: instance.id,
    actorId: params.validatedById,
    previousValues: { status: instance.status },
    newValues: {
      status: 'COMPLETED',
      completedAt: completedAt.toISOString(),
      usedPlanRevisionId: submission.usedPlanRevisionId,
      usedDocumentRevisionIds: submission.usedDocumentRevisionIds,
    },
    idempotencyKey: submission.idempotencyKey,
    source: 'system',
  });

  await writeOutboxEvent(tx, {
    organizationId: params.organizationId,
    aggregateType: 'work_step_instance',
    aggregateId: instance.id,
    eventType: 'work_step.completed',
    payload: {
      productionOrderId: instance.productionOrderId,
      completedAt: completedAt.toISOString(),
      usedPlanRevisionId: submission.usedPlanRevisionId,
    },
  });

  const released = await releaseEligibleSuccessors(tx, {
    organizationId: params.organizationId,
    completedWorkStepInstanceId: instance.id,
    releasedById: params.validatedById,
  });

  await completeOrderIfFinished(tx, {
    organizationId: params.organizationId,
    productionOrderId: instance.productionOrderId,
    actorId: params.validatedById,
  });

  return {
    submissionId: submission.id,
    result: 'COMPLETED',
    workStepStatus: 'COMPLETED',
    rejectionReasons: [],
    nextStepInstanceIds: released.map((r) => r.workStepInstanceId),
    auditEventId: audit.id,
  };
}

async function completeOrderIfFinished(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; productionOrderId: string; actorId: string },
): Promise<void> {
  const instances = await tx.workStepInstance.findMany({
    where: { productionOrderId: params.productionOrderId },
    select: { status: true },
  });
  const allDone = instances.every((i) => countsAsPredecessorSatisfied(i.status as WorkStepStatus));
  if (!allDone) return;

  const order = await tx.productionOrder.findFirstOrThrow({
    where: { id: params.productionOrderId },
  });
  if (!isValidProductionOrderTransition(order.status as ProductionOrderStatus, 'COMPLETED')) {
    return;
  }

  await tx.productionOrder.update({
    where: { id: order.id },
    data: { status: 'COMPLETED', actualEndAt: new Date(), version: { increment: 1 } },
  });

  await writeAuditEvent(tx, {
    organizationId: params.organizationId,
    eventType: 'production_order.completed',
    resourceType: 'production_order',
    resourceId: order.id,
    actorId: params.actorId,
    previousValues: { status: order.status },
    newValues: { status: 'COMPLETED' },
    source: 'system',
  });

  await writeOutboxEvent(tx, {
    organizationId: params.organizationId,
    aggregateType: 'production_order',
    aggregateId: order.id,
    eventType: 'production_order.completed',
    payload: { orderId: order.id },
  });
}

async function verifyActorPin(actor: Actor, pin: string): Promise<boolean> {
  const user = await withOrgContext(actor.organizationId, (tx) =>
    tx.user.findFirst({
      where: { id: actor.userId },
      select: { confirmationPinHash: true },
    }),
  );
  if (!user) throw new NotFoundError('Benutzer');
  if (!user.confirmationPinHash) {
    throw new ConfirmationFailedError(
      'Für Ihr Konto ist keine Bestätigungs-PIN hinterlegt — bitte an die Administration wenden.',
    );
  }
  return verifyConfirmationPin(pin, user.confirmationPinHash);
}

/**
 * A digest that binds who confirmed what, when — the MVP's evidence of
 * confirmation per ADR-005 (PIN + audit trail). It is intentionally not a
 * cryptographic signature over the document set: qualified electronic
 * signatures are out of MVP scope and would be a legal, not just technical,
 * change (docs/10_MVP_PLAN.md "Bewusst außerhalb MVP").
 */
function buildSignatureDigest(params: {
  userId: string;
  workStepInstanceId: string;
  confirmedAt: Date;
  method: string;
}): string {
  return createHash('sha256')
    .update(
      [
        params.userId,
        params.workStepInstanceId,
        STEP_CONFIRMATION_TEXT_VERSION,
        params.confirmedAt.toISOString(),
        params.method,
      ].join('|'),
    )
    .digest('hex');
}

function parseRejectionReasons(validationReason: string | null): EvidenceGap[] {
  if (!validationReason) return [];
  try {
    const parsed: unknown = JSON.parse(validationReason);
    return Array.isArray(parsed) ? (parsed as EvidenceGap[]) : [];
  } catch {
    return [];
  }
}
