import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { confirmWithPin } from '@/domain/identity/confirm-with-pin';
import { NotFoundError, SamePersonReviewDeniedError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { finalizeStepCompletion } from '@/domain/execution/complete-work-step';

/**
 * Vier-Augen-Prinzip (Abnahmeszenario E, docs/04 "Vier-Augen-Prinzip").
 *
 * A step that demands four eyes reaches AWAITING_SECOND_APPROVAL after its
 * own validation passed — it is NOT complete, and its successors stay
 * locked, until a second, different, qualified person confirms it here.
 *
 * Three independent barriers stop "Mitarbeiter A prüft sich selbst":
 *  1. the permission `second_approval.decide`, which WORKER does not hold,
 *  2. the executor ≠ reviewer check below, and
 *  3. a CHECK constraint on second_approvals, so it holds even if a future
 *     code path forgets (Negativtest #9).
 */

export type SecondApprovalDecision = 'APPROVE' | 'REJECT';

export interface DecideSecondApprovalCommand {
  actor: Actor;
  workStepInstanceId: string;
  decision: SecondApprovalDecision;
  reason?: string;
  /** Re-authentication for a critical action, per docs/04
   *  "Re-Authentifizierung für kritische Aktionen". */
  pin: string;
}

export interface SecondApprovalResult {
  workStepInstanceId: string;
  status: string;
  reviewerStatus: string;
  nextStepInstanceIds: string[];
}

export async function decideSecondApproval(
  command: DecideSecondApprovalCommand,
): Promise<SecondApprovalResult> {
  await assertPermission(command.actor, 'second_approval.decide');

  if (command.decision === 'REJECT' && !command.reason?.trim()) {
    throw new ValidationError('Eine Ablehnung der Vier-Augen-Prüfung erfordert eine Begründung.');
  }

  await confirmWithPin(command.actor, command.pin, { purpose: 'second_approval.decision' });

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await tx.workStepInstance.findFirst({
      where: { id: command.workStepInstanceId },
      include: { secondApproval: true },
    });
    if (!instance) throw new NotFoundError('Arbeitsschritt');
    if (instance.status !== 'AWAITING_SECOND_APPROVAL' || !instance.secondApproval) {
      throw new ValidationError(
        `Für diesen Arbeitsschritt steht keine Vier-Augen-Prüfung aus (Status: ${instance.status}).`,
      );
    }
    if (instance.secondApproval.executorId === command.actor.userId) {
      throw new SamePersonReviewDeniedError();
    }

    const reviewerStatus = command.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await tx.secondApproval.update({
      where: { id: instance.secondApproval.id },
      data: {
        reviewerId: command.actor.userId,
        reviewerStatus,
        reviewerReason: command.reason,
        reviewedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (command.decision === 'REJECT') {
      await tx.workStepInstance.update({
        where: { id: instance.id },
        data: { status: 'COMPLETION_REJECTED', version: { increment: 1 } },
      });
      // The execution itself stays on record — only its acceptance was
      // refused ("die ursprüngliche Ausführung bleibt erhalten",
      // MASTERPROMPT.md Kap. 8).
      const latestSubmission = await tx.completionSubmission.findFirst({
        where: { workStepInstanceId: instance.id },
        orderBy: { createdAt: 'desc' },
      });
      if (latestSubmission) {
        await tx.completionSubmission.update({
          where: { id: latestSubmission.id },
          data: {
            status: 'REJECTED',
            validationStatus: 'SECOND_APPROVAL_REJECTED',
            validationReason: JSON.stringify([
              {
                code: 'SECOND_APPROVAL_REJECTED',
                detail: command.reason ?? 'Vier-Augen-Prüfung abgelehnt.',
              },
            ]),
            validatedAt: new Date(),
            validatedById: command.actor.userId,
            version: { increment: 1 },
          },
        });
      }

      await writeAuditEvent(tx, {
        organizationId: command.actor.organizationId,
        eventType: 'second_approval.rejected',
        resourceType: 'work_step_instance',
        resourceId: instance.id,
        actorId: command.actor.userId,
        previousValues: { status: instance.status },
        newValues: { status: 'COMPLETION_REJECTED', reviewerStatus },
        reason: command.reason,
        result: 'FAILURE',
        source: 'web',
      });

      return {
        workStepInstanceId: instance.id,
        status: 'COMPLETION_REJECTED',
        reviewerStatus,
        nextStepInstanceIds: [],
      };
    }

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'second_approval.granted',
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: command.actor.userId,
      previousValues: { status: instance.status },
      newValues: {
        reviewerStatus,
        executorId: instance.secondApproval.executorId,
        reviewerId: command.actor.userId,
      },
      reason: command.reason,
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'work_step_instance',
      aggregateId: instance.id,
      eventType: 'second_approval.granted',
      payload: { workStepInstanceId: instance.id, reviewerId: command.actor.userId },
    });

    const finalized = await finalizeStepCompletion(tx, {
      organizationId: command.actor.organizationId,
      workStepInstanceId: instance.id,
      actorId: command.actor.userId,
    });

    return {
      workStepInstanceId: instance.id,
      status: 'COMPLETED',
      reviewerStatus,
      nextStepInstanceIds: finalized.nextStepInstanceIds,
    };
  });
}

// NOTE on "passende Prüferqualifikation" (MASTERPROMPT.md Kap. 8): the
// permission check above already enforces a time-limited, valid grant
// (user_roles.expires_at). A qualification requirement specific to the
// REVIEWER cannot be enforced yet — plan steps carry no reviewer
// qualification field, only fourEyesScope. Adding one is a planning-model
// change and belongs with the configurable requirement surface; tracked in
// notes.md rather than silently approximated here.
