import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { verifyConfirmationPin } from '@/lib/auth/confirmation-pin';
import { ConfirmationFailedError, NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { validateSubmissionWithin } from '@/domain/execution/complete-work-step';
import { releaseWorkStepInstance } from '@/domain/execution/release-work-step';
import {
  isValidWorkStepTransition,
  type WorkStepStatus,
} from '@/domain/execution/work-step-status';
import { raiseNonConformanceWithin } from '@/domain/quality/raise-non-conformance';
import {
  applyProductionHoldWithin,
  hasOpenBlockingNonConformance,
} from '@/domain/quality/production-holds';
import {
  DECISION_LABEL,
  isDecisionAllowed,
  type ConflictDecisionType,
  type ConflictType,
} from './conflict-types';

/**
 * The conflict centre's business end — docs/07 B4, docs/06 "Berechtigte
 * Person entscheidet (auditiert)".
 *
 * Every branch obeys the same rule, which is the whole point of the
 * mechanism: **the history is never rewritten**. The captured evidence, the
 * timestamps, the revision the work was actually performed against — none of
 * it changes here. What a decision changes is what happens NEXT: whether the
 * step counts as complete, whether it is repeated, whether quality takes
 * over, whether the order is frozen.
 *
 * A decision requires PIN re-authentication for the same reason a step
 * confirmation does (docs/04 "Re-Authentifizierung für kritische Aktionen"):
 * it is a statement about product conformity attributable to a person.
 */

export interface DecideConflictCommand {
  actor: Actor;
  conflictId: string;
  decision: ConflictDecisionType;
  reason: string;
  pin: string;
}

export interface ConflictDecisionResult {
  conflictId: string;
  decision: ConflictDecisionType;
  resultingAction: string;
  workStepStatus?: string;
  nextStepInstanceIds: string[];
}

export async function decideSyncConflict(
  command: DecideConflictCommand,
): Promise<ConflictDecisionResult> {
  await assertPermission(command.actor, 'sync_conflict.decide');

  if (!command.reason.trim()) {
    throw new ValidationError('Eine Konfliktentscheidung erfordert eine Begründung.');
  }

  const pinValid = await verifyActorPin(command.actor, command.pin);
  if (!pinValid) {
    throw new ConfirmationFailedError('Die eingegebene PIN ist nicht korrekt.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const conflict = await tx.syncConflict.findFirst({
      where: { id: command.conflictId },
      include: { syncCommand: { select: { id: true, actorId: true, payload: true } } },
    });
    if (!conflict) throw new NotFoundError('Synchronisationskonflikt');
    if (conflict.status !== 'OPEN') {
      throw new ValidationError(
        `Dieser Konflikt wurde bereits entschieden (Status: ${conflict.status}).`,
      );
    }

    const conflictType = conflict.conflictType as ConflictType;
    if (!isDecisionAllowed(conflictType, command.decision)) {
      // Not a formality: it is what stops "weiterhin gültig" from being
      // applied to a conflict whose evidence is corrupt.
      throw new ValidationError(
        `Die Entscheidung „${DECISION_LABEL[command.decision]}" ist für einen Konflikt vom Typ ${conflictType} nicht zulässig.`,
      );
    }

    const outcome = await applyDecision(tx, command, conflict, conflictType);

    await tx.conflictDecision.create({
      data: {
        organizationId: command.actor.organizationId,
        syncConflictId: conflict.id,
        decidedById: command.actor.userId,
        decisionType: command.decision,
        reason: command.reason,
        resultingAction: outcome.resultingAction,
      },
    });

    await tx.syncConflict.update({
      where: { id: conflict.id },
      data: {
        // RETRY leaves the conflict decided but the situation unchanged; it
        // is CANCELLED rather than RESOLVED so a report can tell "we acted"
        // from "we waited".
        status: command.decision === 'RETRY_AFTER_RESOLUTION' ? 'CANCELLED' : 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: command.actor.userId,
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'sync_conflict.decided',
      resourceType: 'sync_conflict',
      resourceId: conflict.id,
      actorId: command.actor.userId,
      previousValues: { status: 'OPEN' },
      newValues: {
        decision: command.decision,
        conflictType,
        resultingAction: outcome.resultingAction,
        workStepInstanceId: conflict.workStepInstanceId,
      },
      reason: command.reason,
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'sync_conflict',
      aggregateId: conflict.id,
      eventType: 'sync_conflict.resolved',
      payload: {
        conflictId: conflict.id,
        conflictType,
        decision: command.decision,
        workStepInstanceId: conflict.workStepInstanceId,
        productionOrderId: conflict.productionOrderId,
      },
    });

    return {
      conflictId: conflict.id,
      decision: command.decision,
      resultingAction: outcome.resultingAction,
      workStepStatus: outcome.workStepStatus,
      nextStepInstanceIds: outcome.nextStepInstanceIds,
    };
  });
}

type ConflictRow = Prisma.SyncConflictGetPayload<{
  include: { syncCommand: { select: { id: true; actorId: true; payload: true } } };
}>;

interface DecisionOutcome {
  resultingAction: string;
  workStepStatus?: string;
  nextStepInstanceIds: string[];
}

async function applyDecision(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
  conflictType: ConflictType,
): Promise<DecisionOutcome> {
  switch (command.decision) {
    case 'ACCEPT_AS_VALID':
      return acceptAsValid(tx, command, conflict);
    case 'ADDITIONAL_INSPECTION_REQUIRED':
      return raiseFollowUpNonConformance(tx, command, conflict, conflictType, false);
    case 'REWORK_REQUIRED':
      return raiseFollowUpNonConformance(tx, command, conflict, conflictType, true);
    case 'REPEAT_REQUIRED':
      return repeatStep(tx, command, conflict);
    case 'PRODUCTION_HOLD':
      return holdProduction(tx, command, conflict);
    case 'REQUEST_REUPLOAD':
      return requestReupload(tx, command, conflict);
    case 'RETRY_AFTER_RESOLUTION':
      return {
        resultingAction:
          'Keine Zustandsänderung — das Gerät darf das Kommando erneut senden, sobald die Ursache behoben ist.',
        nextStepInstanceIds: [],
      };
    case 'DISCARD_SUBMISSION':
      return discardSubmission(tx, command, conflict);
  }
}

/**
 * "Weiterhin gültig – keine Auswirkung" (docs/06 a).
 *
 * The submission is put back through the SAME server-side validation every
 * other completion goes through — requirements, tolerances, four eyes — with
 * only the revision question marked as already answered. That matters: the
 * decision was "the old revision is still acceptable", not "skip the checks".
 * A step whose photo is missing stays rejected even after this decision.
 *
 * The submission keeps its original submitter, its original client timestamp
 * and its original `usedDocumentRevisionIds`. The completed step therefore
 * still reads "executed against Rev. 04", with the decision beside it.
 */
async function acceptAsValid(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
): Promise<DecisionOutcome> {
  await requireStep(tx, conflict);
  if (!conflict.completionSubmissionId) {
    throw new ValidationError(
      'Für diesen Konflikt liegt keine Abschlussmeldung vor, die bestätigt werden könnte.',
    );
  }

  const result = await validateSubmissionWithin(tx, {
    organizationId: command.actor.organizationId,
    submissionId: conflict.completionSubmissionId,
    validatedById: command.actor.userId,
    revisionConflictAlreadyDecided: true,
  });

  if (result.result === 'REJECTED') {
    return {
      resultingAction: `Erneute Prüfung ergab offene Pflichtnachweise: ${result.rejectionReasons
        .map((r) => r.detail)
        .join('; ')}`,
      workStepStatus: result.workStepStatus,
      nextStepInstanceIds: [],
    };
  }

  return {
    resultingAction:
      result.result === 'AWAITING_SECOND_APPROVAL'
        ? 'Ausführung anerkannt; der Schritt wartet noch auf die Vier-Augen-Bestätigung.'
        : 'Arbeitsschritt mit der ursprünglich verwendeten Revision abgeschlossen; Entscheidung vermerkt.',
    workStepStatus: result.workStepStatus,
    nextStepInstanceIds: result.nextStepInstanceIds,
  };
}

/**
 * "Zusatzprüfung erforderlich" (c) and "Nacharbeit erforderlich" (b) both
 * hand the case to the quality process built in Phase 4 rather than growing
 * a parallel one. The difference is only the blocking classification, and
 * even that is a *suggestion*: classifyBlocking inside raiseNonConformance
 * decides, and it may escalate but never soften (see ncr-status.ts).
 */
async function raiseFollowUpNonConformance(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
  conflictType: ConflictType,
  blocking: boolean,
): Promise<DecisionOutcome> {
  const instance = await requireStep(tx, conflict);

  const ncr = await raiseNonConformanceWithin(tx, {
    actor: command.actor,
    productionOrderId: instance.productionOrderId,
    workStepInstanceId: instance.id,
    description:
      `${conflictType}: ${conflict.summary}\n\n` +
      `Entscheidung der Konfliktbearbeitung: ${DECISION_LABEL[command.decision]}.\n` +
      `Begründung: ${command.reason}`,
    errorCategory: 'REVISIONSKONFLIKT',
    priority: blocking ? 'HIGH' : 'MEDIUM',
    reporterSuggestsBlocking: blocking,
    discoveredAt: new Date(),
  });

  return {
    resultingAction: `Abweichung ${ncr.ncrNumber} angelegt (${ncr.isBlocking ? 'blockierend' : 'nicht blockierend'}).`,
    workStepStatus: ncr.isBlocking ? 'BLOCKED' : undefined,
    nextStepInstanceIds: [],
  };
}

/**
 * "Wiederholung erforderlich" (d). The offline execution is marked
 * SUPERSEDED — kept, readable, attributable — and a NEW attempt of the same
 * plan step is created and released, so the work is redone against the
 * current revision. Deliberately not a reset of the existing row: the point
 * of MASTERPROMPT.md Kap. 9 ("Der ursprüngliche Schritt wird niemals
 * rückwirkend als fehlerfrei umgeschrieben") applies here just as it does to
 * rework.
 */
async function repeatStep(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
): Promise<DecisionOutcome> {
  const instance = await requireStep(tx, conflict);

  await tx.workStepInstance.update({
    where: { id: instance.id },
    data: { status: 'SUPERSEDED', version: { increment: 1 } },
  });

  const latestAttempt = await tx.workStepInstance.findFirst({
    where: { productionOrderId: instance.productionOrderId, planStepId: instance.planStepId },
    orderBy: { attemptNumber: 'desc' },
    select: { attemptNumber: true },
  });

  const repeat = await tx.workStepInstance.create({
    data: {
      organizationId: command.actor.organizationId,
      productionOrderId: instance.productionOrderId,
      planStepId: instance.planStepId,
      stepNumber: instance.stepNumber,
      stepKind: 'PRODUCTION',
      attemptNumber: (latestAttempt?.attemptNumber ?? instance.attemptNumber) + 1,
      status: 'LOCKED',
    },
  });

  // Released straight away: the predecessors were satisfied when the
  // original was released, and nothing about them changed. What changed is
  // the document set, which the new release token now pins.
  //
  // Unless quality is holding the order. releaseEligibleSuccessors refuses to
  // release into an open blocking NCR for a stated reason — "so that a
  // successor is not even shown as READY while a blocking NCR is open" — and
  // this path skipped that check, so a repeat could appear as READY on the
  // tablet while every attempt to start it was refused by
  // assertNotBlockedForStep. The invariant held; the screen lied. The repeat
  // stays LOCKED instead and is released by the NCR workflow like any other
  // step waiting on a disposition.
  const blocked = await hasOpenBlockingNonConformance(tx, instance.productionOrderId);
  const released = blocked
    ? null
    : await releaseWorkStepInstance(tx, {
        organizationId: command.actor.organizationId,
        workStepInstanceId: repeat.id,
        releasedById: command.actor.userId,
      });

  await writeAuditEvent(tx, {
    organizationId: command.actor.organizationId,
    eventType: 'work_step.superseded',
    resourceType: 'work_step_instance',
    resourceId: instance.id,
    actorId: command.actor.userId,
    previousValues: { status: instance.status },
    newValues: { status: 'SUPERSEDED', repeatedAsWorkStepInstanceId: repeat.id },
    reason: command.reason,
    source: 'web',
  });

  return {
    resultingAction: blocked
      ? `Ausführung als überholt markiert; Wiederholung als Versuch ${repeat.attemptNumber} angelegt, aber noch gesperrt — eine blockierende Abweichung ist offen.`
      : `Ausführung als überholt markiert; Wiederholung als Versuch ${repeat.attemptNumber} freigegeben.`,
    workStepStatus: 'SUPERSEDED',
    nextStepInstanceIds: released ? [released.workStepInstanceId] : [],
  };
}

/** "Produktsperre" (e). */
async function holdProduction(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
): Promise<DecisionOutcome> {
  if (!conflict.productionOrderId) {
    throw new ValidationError('Für diesen Konflikt ist kein Produktionsauftrag hinterlegt.');
  }

  const hold = await applyProductionHoldWithin(tx, {
    actor: command.actor,
    scopeType: 'ORDER',
    productionOrderId: conflict.productionOrderId,
    holdReason: `Revisionskonflikt: ${conflict.summary}`,
    releaseCondition: command.reason,
  });

  return {
    resultingAction: `Auftrag gesperrt (Sperre ${hold.id}).`,
    nextStepInstanceIds: [],
  };
}

/** MISSING_OR_CORRUPT_EVIDENCE → the device sends the file again. The photo
 *  row is marked FAILED so it stops counting as evidence, and the step goes
 *  back to IN_PROGRESS so the worker can retake it. */
async function requestReupload(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
): Promise<DecisionOutcome> {
  const detail = conflict.detail as Record<string, unknown> | null;
  const photoEvidenceId =
    typeof detail?.photoEvidenceId === 'string' ? detail.photoEvidenceId : null;

  if (photoEvidenceId) {
    await tx.photoEvidence.updateMany({
      where: { id: photoEvidenceId, uploadStatus: { not: 'COMPLETED' } },
      data: { uploadStatus: 'FAILED', version: { increment: 1 } },
    });
    await tx.photoUploadChunk.deleteMany({ where: { photoEvidenceId } });
  }

  const status = await reopenStepForWork(tx, command, conflict);
  return {
    resultingAction: 'Nachweis zur erneuten Übertragung angefordert.',
    workStepStatus: status,
    nextStepInstanceIds: [],
  };
}

/**
 * The completion request is dropped; everything that was CAPTURED stays.
 * That distinction is the whole of docs/06's "preserveAsHistoricalFact":
 * checklist answers, photos and measurements are facts about what was done,
 * and only the claim "and therefore this step is finished" is refused.
 */
async function discardSubmission(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
): Promise<DecisionOutcome> {
  if (conflict.completionSubmissionId) {
    await tx.completionSubmission.updateMany({
      where: { id: conflict.completionSubmissionId, status: 'PENDING_VALIDATION' },
      data: {
        status: 'REJECTED',
        validationStatus: conflict.conflictType,
        validationReason: JSON.stringify([{ code: conflict.conflictType, detail: command.reason }]),
        validatedAt: new Date(),
        validatedById: command.actor.userId,
        version: { increment: 1 },
      },
    });
  }

  const status = await reopenStepForWork(tx, command, conflict);
  return {
    resultingAction:
      'Abschlussmeldung verworfen; erfasste Nachweise bleiben erhalten, Schritt ist wieder in Bearbeitung.',
    workStepStatus: status,
    nextStepInstanceIds: [],
  };
}

async function reopenStepForWork(
  tx: Prisma.TransactionClient,
  command: DecideConflictCommand,
  conflict: ConflictRow,
): Promise<string | undefined> {
  if (!conflict.workStepInstanceId) return undefined;

  const instance = await tx.workStepInstance.findFirst({
    where: { id: conflict.workStepInstanceId },
    select: { id: true, status: true },
  });
  if (!instance) return undefined;
  // Two conditions, and both are needed.
  //
  // The first is intent: only a step that is actually waiting on THIS
  // decision is reopened. One that has meanwhile been completed or superseded
  // by another path is left alone rather than dragged backwards.
  //
  // The second is the state machine. The list used to be the only check and
  // it contained VALIDATING — a status with no VALIDATING → IN_PROGRESS edge,
  // so the write went around the machine that work-step-status.ts exists to
  // be the single authority for. (Unreachable in practice, since validation
  // runs in the same transaction that sets VALIDATING; unreachable is not the
  // same as guarded.) Asking isValidWorkStepTransition as well means the
  // conflict centre cannot become a back door for a status added later.
  const status = instance.status as WorkStepStatus;
  const awaitingThisDecision =
    status === 'BLOCKED' || status === 'VALIDATING' || status === 'COMPLETION_REJECTED';
  if (!awaitingThisDecision || !isValidWorkStepTransition(status, 'IN_PROGRESS')) {
    return instance.status;
  }

  await tx.workStepInstance.update({
    where: { id: instance.id },
    data: { status: 'IN_PROGRESS', version: { increment: 1 } },
  });

  await writeAuditEvent(tx, {
    organizationId: command.actor.organizationId,
    eventType: 'work_step.reopened_after_conflict',
    resourceType: 'work_step_instance',
    resourceId: instance.id,
    actorId: command.actor.userId,
    previousValues: { status: instance.status },
    newValues: { status: 'IN_PROGRESS', conflictId: conflict.id },
    reason: command.reason,
    source: 'web',
  });

  return 'IN_PROGRESS';
}

async function requireStep(tx: Prisma.TransactionClient, conflict: ConflictRow) {
  if (!conflict.workStepInstanceId) {
    throw new ValidationError('Für diesen Konflikt ist kein Arbeitsschritt hinterlegt.');
  }
  const instance = await tx.workStepInstance.findFirst({
    where: { id: conflict.workStepInstanceId },
    select: {
      id: true,
      status: true,
      stepNumber: true,
      planStepId: true,
      attemptNumber: true,
      productionOrderId: true,
    },
  });
  if (!instance) throw new NotFoundError('Arbeitsschritt');
  return instance;
}

async function verifyActorPin(actor: Actor, pin: string): Promise<boolean> {
  const user = await withOrgContext(actor.organizationId, (tx) =>
    tx.user.findFirst({ where: { id: actor.userId }, select: { confirmationPinHash: true } }),
  );
  if (!user) throw new NotFoundError('Benutzer');
  if (!user.confirmationPinHash) {
    throw new ConfirmationFailedError(
      'Für Ihr Konto ist keine Bestätigungs-PIN hinterlegt — bitte an die Administration wenden.',
    );
  }
  return verifyConfirmationPin(pin, user.confirmationPinHash);
}
