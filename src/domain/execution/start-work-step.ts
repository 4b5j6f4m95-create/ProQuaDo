import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { assertPermissionWithin } from '@/lib/authz/permission-within';
import { AuthzError } from '@/lib/authz/errors';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';
import {
  BlockingNonConformanceError,
  InvalidReleaseTokenError,
  InvalidStateTransitionError,
  NotFoundError,
  OrderOnHoldError,
  ProductionHoldActiveError,
  WorkStepNotReadyError,
} from '@/lib/domain-errors';
import { hashTokenSignature, verifyReleaseToken } from '@/lib/security/release-token';
import type { Actor } from '@/domain/shared/actor';
import { assertAssignedToOrder } from '@/domain/production-orders/order-access';
import {
  isOrderExecutable,
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from '@/domain/production-orders/production-order-status';
import { assertNotBlockedForStep } from './execution-guards';
import { isValidWorkStepTransition, type WorkStepStatus } from './work-step-status';

export interface StartWorkStepCommand {
  actor: Actor;
  workStepInstanceId: string;
  /**
   * Optional. An online client does not have one: the release happened
   * server-side (when the predecessor was validated) and the server checks
   * its own `work_step_releases` row, which is strictly stronger than any
   * token check. The token exists for the offline case — a device that was
   * handed a token before losing connectivity presents it here on
   * reconnect, and it is verified against the same row. Either way, the
   * decision is made from server state (docs/06 "Release Token – Design").
   */
  releaseToken?: string;
  deviceId?: string;
  clientTimestamp?: Date;
}

export type StartDenialReason =
  | 'NOT_FOUND'
  | 'NOT_ASSIGNED'
  | 'ORDER_ON_HOLD'
  | 'WORK_STEP_NOT_READY'
  | 'INVALID_RELEASE_TOKEN'
  | 'ROLE_NOT_HELD';

export interface StartDecision {
  allowed: boolean;
  reason?: StartDenialReason;
  message?: string;
}

/**
 * Read-only precondition check, mirroring `canStartWorkStep` in docs/03
 * "Guard Condition Patterns". The UI uses it to decide whether to offer a
 * "Starten" button; it is NOT the security boundary — startWorkStep()
 * re-checks every one of these conditions inside the mutating transaction,
 * because anything checked earlier may have changed by then.
 */
export async function canStartWorkStep(
  actor: Actor,
  workStepInstanceId: string,
  releaseToken?: string,
): Promise<StartDecision> {
  // No permission assert up front: which permission applies depends on the
  // step's kind, which is only known after loading it. The check happens
  // inside assertStartPreconditions, in the same transaction.
  return withOrgContext(actor.organizationId, async (tx) => {
    const instance = await loadInstance(tx, workStepInstanceId);
    if (!instance)
      return { allowed: false, reason: 'NOT_FOUND', message: 'Arbeitsschritt nicht gefunden.' };

    try {
      await assertStartPreconditions(tx, actor, instance, releaseToken);
    } catch (error) {
      return toDecision(error);
    }
    return { allowed: true };
  });
}

/**
 * READY → IN_PROGRESS. The only transition that lets a person begin work,
 * and it is granted by the server after re-verifying: assignment, order
 * status, step status, the persisted release, the presented token (if any)
 * and the role the plan step demands.
 */
export async function startWorkStep(command: StartWorkStepCommand) {
  // See canStartWorkStep: the required permission depends on the step kind,
  // so it is asserted inside the transaction rather than here.
  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await loadInstance(tx, command.workStepInstanceId);
    if (!instance) throw new NotFoundError('Arbeitsschritt');

    await assertStartPreconditions(tx, command.actor, instance, command.releaseToken);

    if (!isValidWorkStepTransition(instance.status as WorkStepStatus, 'IN_PROGRESS')) {
      throw new InvalidStateTransitionError('Arbeitsschritt', instance.status, 'IN_PROGRESS');
    }

    const updated = await tx.workStepInstance.update({
      where: { id: instance.id },
      data: {
        status: 'IN_PROGRESS',
        startedById: command.actor.userId,
        startedAt: new Date(),
        version: { increment: 1 },
      },
    });

    // First started step moves the order itself into IN_PROGRESS
    // (docs/03 §1: "RELEASED → IN_PROGRESS: Erster Schritt gestartet").
    if (
      isValidProductionOrderTransition(
        instance.productionOrder.status as ProductionOrderStatus,
        'IN_PROGRESS',
      )
    ) {
      await tx.productionOrder.update({
        where: { id: instance.productionOrderId },
        data: {
          status: 'IN_PROGRESS',
          actualStartAt: instance.productionOrder.actualStartAt ?? new Date(),
          version: { increment: 1 },
        },
      });
    }

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.started',
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: command.actor.userId,
      previousValues: { status: instance.status },
      newValues: { status: updated.status },
      deviceId: command.deviceId,
      clientTimestamp: command.clientTimestamp,
      source: command.deviceId ? 'mobile' : 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'work_step_instance',
      aggregateId: instance.id,
      eventType: 'work_step.started',
      payload: {
        productionOrderId: instance.productionOrderId,
        actorId: command.actor.userId,
        deviceId: command.deviceId ?? null,
      },
    });

    return updated;
  });
}

export interface PauseResumeCommand {
  actor: Actor;
  workStepInstanceId: string;
  reason?: string;
}

export async function pauseWorkStep(command: PauseResumeCommand) {
  return transitionExecutionState(command, 'IN_PROGRESS', 'PAUSED', 'work_step.paused');
}

export async function resumeWorkStep(command: PauseResumeCommand) {
  return transitionExecutionState(command, 'PAUSED', 'IN_PROGRESS', 'work_step.resumed');
}

/**
 * Returns a step whose completion the server rejected to IN_PROGRESS so the
 * worker can fix what was missing and resubmit. See the comment on
 * COMPLETION_REJECTED in work-step-status.ts for why this transition exists
 * beyond the documented machine.
 */
export async function reworkRejectedCompletion(command: PauseResumeCommand) {
  return transitionExecutionState(
    command,
    'COMPLETION_REJECTED',
    'IN_PROGRESS',
    'work_step.reopened_after_rejection',
  );
}

async function transitionExecutionState(
  command: PauseResumeCommand,
  expectedFrom: WorkStepStatus,
  to: WorkStepStatus,
  eventType: string,
) {
  await assertPermission(command.actor, 'work_step.pause');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await loadInstance(tx, command.workStepInstanceId);
    if (!instance) throw new NotFoundError('Arbeitsschritt');

    await assertAssignedToOrder(tx, command.actor, instance.productionOrderId);
    if (instance.status !== expectedFrom) {
      throw new InvalidStateTransitionError('Arbeitsschritt', instance.status, to);
    }

    const updated = await tx.workStepInstance.update({
      where: { id: instance.id },
      data: { status: to, version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType,
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: command.actor.userId,
      previousValues: { status: instance.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}

type LoadedInstance = NonNullable<Awaited<ReturnType<typeof loadInstance>>>;

async function loadInstance(tx: Prisma.TransactionClient, workStepInstanceId: string) {
  return tx.workStepInstance.findFirst({
    where: { id: workStepInstanceId },
    include: {
      release: true,
      productionOrder: { select: { id: true, status: true, actualStartAt: true } },
      planStep: { select: { id: true, title: true, requiredRole: true } },
    },
  });
}

const PERMISSION_BY_STEP_KIND: Record<string, PermissionCode> = {
  PRODUCTION: 'work_step.execute',
  REWORK: 'rework.execute',
  REINSPECTION: 'reinspection.execute',
};

const STEP_KIND_DENIED_MESSAGE: Record<string, string> = {
  PRODUCTION: 'Sie besitzen nicht die Berechtigung, Arbeitsschritte auszuführen.',
  REWORK: 'Sie besitzen nicht die Berechtigung, Nacharbeit auszuführen.',
  REINSPECTION: 'Nachprüfungen dürfen nur von einer prüfberechtigten Person ausgeführt werden.',
};

/**
 * The guard chain, in the order the failures should be reported: what you
 * are allowed to touch, whether the order allows work at all, whether this
 * step is released, whether the presented token is genuine, whether the
 * step's required role is held.
 */
async function assertStartPreconditions(
  tx: Prisma.TransactionClient,
  actor: Actor,
  instance: LoadedInstance,
  releaseToken: string | undefined,
): Promise<void> {
  await assertAssignedToOrder(tx, actor, instance.productionOrderId);

  // Which permission a step demands depends on what kind of step it is
  // (docs/04): a WORKER executes production and rework, an INSPECTOR the
  // reinspection. Checked here rather than up front because the answer is
  // only known once the instance has been read.
  await assertPermissionWithin(
    tx,
    actor,
    PERMISSION_BY_STEP_KIND[instance.stepKind] ?? 'work_step.execute',
    STEP_KIND_DENIED_MESSAGE[instance.stepKind],
  );

  // Holds freeze regular production but not the rework/reinspection that
  // resolves the very NCR behind the hold — see assertNotBlockedForStep.
  await assertNotBlockedForStep(tx, instance);

  if (!isOrderExecutable(instance.productionOrder.status as ProductionOrderStatus)) {
    // A quality-blocked order still permits its rework and reinspection
    // steps; everything else stops here (Negativtest #10).
    if (
      instance.stepKind === 'PRODUCTION' ||
      instance.productionOrder.status !== 'QUALITY_BLOCKED'
    ) {
      throw new OrderOnHoldError(instance.productionOrder.status);
    }
  }

  if (instance.status !== 'READY') {
    // The invariant made visible: a successor whose predecessor is only
    // locally complete is still LOCKED here, so this is exactly where
    // Negativtest #1 ("Schritt 6 starten") fails, with WORK_STEP_NOT_READY.
    throw new WorkStepNotReadyError(instance.status);
  }

  const release = instance.release;
  if (!release || !release.isValid) {
    throw new InvalidReleaseTokenError('keine gültige Serverfreigabe vorhanden');
  }
  if (release.validUntil && release.validUntil < new Date()) {
    throw new InvalidReleaseTokenError('Freigabe abgelaufen');
  }

  if (releaseToken !== undefined) {
    const verification = verifyReleaseToken(releaseToken);
    if (!verification.valid) {
      throw new InvalidReleaseTokenError(verification.reason);
    }
    // Binding the token to THIS step is what stops a token issued for step
    // N from starting step N+1 (docs/06, Negativtest #2).
    if (verification.payload.workStepInstanceId !== instance.id) {
      throw new InvalidReleaseTokenError('Token gehört zu einem anderen Arbeitsschritt');
    }
    if (
      verification.payload.tokenId !== release.tokenNonce ||
      hashTokenSignature(verification.signature) !== release.tokenHash
    ) {
      throw new InvalidReleaseTokenError('Token wurde zurückgezogen oder ersetzt');
    }
  }

  if (instance.planStep.requiredRole) {
    const holdsRole = await tx.userRole.findFirst({
      where: {
        userId: actor.userId,
        organizationId: actor.organizationId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        role: { code: instance.planStep.requiredRole },
      },
      select: { id: true },
    });
    if (!holdsRole) {
      throw new AuthzError(
        'PERMISSION_DENIED',
        `Dieser Arbeitsschritt erfordert die Rolle „${instance.planStep.requiredRole}".`,
      );
    }
  }
}

function toDecision(error: unknown): StartDecision {
  if (error instanceof OrderOnHoldError) {
    return { allowed: false, reason: 'ORDER_ON_HOLD', message: error.message };
  }
  if (error instanceof WorkStepNotReadyError) {
    return { allowed: false, reason: 'WORK_STEP_NOT_READY', message: error.message };
  }
  if (error instanceof InvalidReleaseTokenError) {
    return { allowed: false, reason: 'INVALID_RELEASE_TOKEN', message: error.message };
  }
  if (error instanceof AuthzError) {
    return {
      allowed: false,
      reason: error.message.includes('zugewiesen') ? 'NOT_ASSIGNED' : 'ROLE_NOT_HELD',
      message: error.message,
    };
  }
  if (error instanceof BlockingNonConformanceError || error instanceof ProductionHoldActiveError) {
    return { allowed: false, reason: 'ORDER_ON_HOLD', message: error.message };
  }
  throw error;
}
