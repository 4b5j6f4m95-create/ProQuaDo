import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import {
  BlockingNonConformanceError,
  NotFoundError,
  ProductionHoldActiveError,
  ValidationError,
} from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

/**
 * Production holds — the server-side freeze that no client can talk its way
 * past (MASTERPROMPT.md Kap. 9). A hold has a scope: project, order, serial
 * number or a single work step, and every execution service asks
 * assertNotBlocked() before it does anything.
 *
 * Holds and blocking NCRs are separate concepts that answer the same
 * question. An NCR is the finding; a hold is the consequence. Raising a
 * blocking NCR issues a hold, closing it releases that hold — but a hold
 * can also exist on its own (a production manager stopping a line), which
 * is why the gate below checks holds, not NCR rows.
 */

export type HoldScopeType = 'PROJECT' | 'ORDER' | 'SERIAL' | 'WORK_STEP';

export interface ActiveHoldSummary {
  id: string;
  scopeType: string;
  holdReason: string;
  releaseCondition: string | null;
  nonConformanceId: string | null;
  issuedAt: Date;
}

/**
 * Every hold that currently freezes this order (and optionally this
 * specific step): order-scoped, project-scoped, serial-scoped and
 * step-scoped ones. Runs inside the caller's transaction so the answer
 * cannot go stale between check and mutation.
 */
export async function findActiveHolds(
  tx: Prisma.TransactionClient,
  scope: {
    productionOrderId: string;
    workStepInstanceId?: string;
    /** Holds issued by this NCR are ignored — used for the rework and
     *  reinspection steps that exist to resolve exactly that NCR. */
    exemptNonConformanceId?: string;
  },
): Promise<ActiveHoldSummary[]> {
  const order = await tx.productionOrder.findFirst({
    where: { id: scope.productionOrderId },
    select: { id: true, projectId: true, serialNumber: true },
  });
  if (!order) return [];

  const holds = await tx.productionHold.findMany({
    where: {
      isActive: true,
      ...(scope.exemptNonConformanceId
        ? { NOT: { nonConformanceId: scope.exemptNonConformanceId } }
        : {}),
      OR: [
        { productionOrderId: order.id },
        { projectId: order.projectId },
        ...(order.serialNumber ? [{ serialNumber: order.serialNumber }] : []),
        ...(scope.workStepInstanceId ? [{ workStepInstanceId: scope.workStepInstanceId }] : []),
      ],
    },
    orderBy: { issuedAt: 'asc' },
    select: {
      id: true,
      scopeType: true,
      holdReason: true,
      releaseCondition: true,
      nonConformanceId: true,
      issuedAt: true,
    },
  });

  return holds;
}

/**
 * The gate. Called by start, evidence capture, completion and successor
 * release — Negativtest #10 ("offene blockierende NCR: Nachfolger bleibt
 * gesperrt") passes because of this call, not because of UI logic.
 */
export async function assertNotBlocked(
  tx: Prisma.TransactionClient,
  scope: {
    productionOrderId: string;
    workStepInstanceId?: string;
    exemptNonConformanceId?: string;
  },
): Promise<void> {
  const holds = await findActiveHolds(tx, scope);
  const first = holds[0];
  if (first) {
    throw new ProductionHoldActiveError(first.holdReason, first.releaseCondition ?? undefined);
  }
}

/** Same question for a step that is not yet materialized into a hold check
 *  — used by successor release, which must not release into an order that
 *  has an open blocking NCR even if its hold was scoped elsewhere. */
export async function hasOpenBlockingNonConformance(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
): Promise<boolean> {
  const ncr = await tx.nonConformance.findFirst({
    where: {
      productionOrderId,
      isBlocking: true,
      status: { notIn: ['CLOSED', 'CANCELLED'] },
    },
    select: { id: true },
  });
  return ncr !== null;
}

export async function assertNoOpenBlockingNonConformance(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
): Promise<void> {
  if (await hasOpenBlockingNonConformance(tx, productionOrderId)) {
    throw new BlockingNonConformanceError();
  }
}

export interface ApplyHoldCommand {
  actor: Actor;
  scopeType: HoldScopeType;
  projectId?: string;
  productionOrderId?: string;
  serialNumber?: string;
  workStepInstanceId?: string;
  nonConformanceId?: string;
  holdReason: string;
  releaseCondition?: string;
}

export async function applyProductionHold(command: ApplyHoldCommand) {
  await assertPermission(command.actor, 'production_hold.create');

  return withOrgContext(command.actor.organizationId, (tx) =>
    applyProductionHoldWithin(tx, command),
  );
}

/** Transaction-scoped variant, so raising a blocking NCR and issuing its
 *  hold are one atomic fact rather than two hopeful writes. */
export async function applyProductionHoldWithin(
  tx: Prisma.TransactionClient,
  command: ApplyHoldCommand,
) {
  assertScopeTargetPresent(command);

  const hold = await tx.productionHold.create({
    data: {
      organizationId: command.actor.organizationId,
      scopeType: command.scopeType,
      projectId: command.projectId,
      productionOrderId: command.productionOrderId,
      serialNumber: command.serialNumber,
      workStepInstanceId: command.workStepInstanceId,
      nonConformanceId: command.nonConformanceId,
      holdReason: command.holdReason,
      releaseCondition: command.releaseCondition,
      isActive: true,
      issuedById: command.actor.userId,
    },
  });

  await writeAuditEvent(tx, {
    organizationId: command.actor.organizationId,
    eventType: 'production_hold.applied',
    resourceType: 'production_hold',
    resourceId: hold.id,
    actorId: command.actor.userId,
    newValues: {
      scopeType: hold.scopeType,
      productionOrderId: hold.productionOrderId,
      workStepInstanceId: hold.workStepInstanceId,
      nonConformanceId: hold.nonConformanceId,
      holdReason: hold.holdReason,
    },
    reason: command.holdReason,
    source: 'web',
  });

  await writeOutboxEvent(tx, {
    organizationId: command.actor.organizationId,
    aggregateType: 'production_hold',
    aggregateId: hold.id,
    eventType: 'production_hold.applied',
    payload: { scope: hold.scopeType, reason: hold.holdReason },
  });

  return hold;
}

export interface ReleaseHoldCommand {
  actor: Actor;
  productionHoldId: string;
  releaseReason: string;
}

/**
 * Releasing a hold requires its own permission and a written reason
 * (MASTERPROMPT.md Kap. 9: "Aufhebung verlangt passende Rolle, Begründung
 * und optional Vier-Augen-Freigabe"). The optional four-eyes variant is not
 * wired up here — it needs a configuration surface that does not exist yet,
 * and is tracked for Phase 6 together with the rest of the org config.
 */
export async function releaseProductionHold(command: ReleaseHoldCommand) {
  await assertPermission(command.actor, 'production_hold.release');

  if (!command.releaseReason.trim()) {
    throw new ValidationError('Die Aufhebung einer Sperre erfordert eine Begründung.');
  }

  return withOrgContext(command.actor.organizationId, (tx) =>
    releaseProductionHoldWithin(tx, command),
  );
}

export async function releaseProductionHoldWithin(
  tx: Prisma.TransactionClient,
  command: ReleaseHoldCommand,
) {
  const hold = await tx.productionHold.findFirst({ where: { id: command.productionHoldId } });
  if (!hold) throw new NotFoundError('Produktionssperre');
  if (!hold.isActive) {
    throw new ValidationError('Diese Sperre ist bereits aufgehoben.');
  }

  const updated = await tx.productionHold.update({
    where: { id: hold.id },
    data: {
      isActive: false,
      releasedById: command.actor.userId,
      releasedAt: new Date(),
      releaseReason: command.releaseReason,
      version: { increment: 1 },
    },
  });

  await writeAuditEvent(tx, {
    organizationId: command.actor.organizationId,
    eventType: 'production_hold.released',
    resourceType: 'production_hold',
    resourceId: hold.id,
    actorId: command.actor.userId,
    previousValues: { isActive: true },
    newValues: { isActive: false, productionOrderId: hold.productionOrderId },
    reason: command.releaseReason,
    source: 'web',
  });

  await writeOutboxEvent(tx, {
    organizationId: command.actor.organizationId,
    aggregateType: 'production_hold',
    aggregateId: hold.id,
    eventType: 'production_hold.released',
    payload: { releasedBy: command.actor.userId },
  });

  return updated;
}

export async function listProductionHolds(
  actor: Actor,
  filter: { productionOrderId?: string; activeOnly?: boolean } = {},
) {
  await assertPermission(actor, 'ncr.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.productionHold.findMany({
      where: {
        productionOrderId: filter.productionOrderId,
        ...(filter.activeOnly === false ? {} : { isActive: true }),
      },
      include: {
        nonConformance: { select: { id: true, ncrNumber: true, status: true } },
        productionOrder: { select: { id: true, orderNumber: true } },
      },
      orderBy: { issuedAt: 'desc' },
    }),
  );
}

function assertScopeTargetPresent(command: ApplyHoldCommand): void {
  const target: Record<HoldScopeType, unknown> = {
    PROJECT: command.projectId,
    ORDER: command.productionOrderId,
    SERIAL: command.serialNumber,
    WORK_STEP: command.workStepInstanceId,
  };
  if (!target[command.scopeType]) {
    throw new ValidationError(
      `Eine Sperre mit Geltungsbereich ${command.scopeType} benötigt das zugehörige Ziel.`,
    );
  }
}
