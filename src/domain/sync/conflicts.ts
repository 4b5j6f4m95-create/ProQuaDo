import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  CONFLICT_TYPE_LABEL,
  DECISIONS_BY_CONFLICT,
  type ConflictType,
  type ConflictDecisionType,
} from './conflict-types';

/**
 * Storage and retrieval of sync conflicts. The decisions themselves — what
 * accepting or rejecting actually does to an order — live in
 * decide-conflict.ts; this module only records that a conflict exists and
 * hands it to the people who may decide it.
 *
 * The governing rule (docs/06 "Kein Last-Write-Wins für Qualitätsdaten"):
 * a conflict is never resolved automatically. The captured work is preserved
 * either way; what a decision changes is whether it counts as a completed
 * step, not whether it happened.
 */

export interface RecordConflictParams {
  organizationId: string;
  conflictType: ConflictType;
  summary: string;
  detail: Record<string, unknown>;
  syncCommandId?: string;
  productionOrderId?: string;
  workStepInstanceId?: string;
  completionSubmissionId?: string;
  detectedByUserId: string;
}

export async function recordConflictWithin(
  tx: Prisma.TransactionClient,
  params: RecordConflictParams,
): Promise<{ id: string }> {
  const conflict = await tx.syncConflict.create({
    data: {
      organizationId: params.organizationId,
      conflictType: params.conflictType,
      status: 'OPEN',
      syncCommandId: params.syncCommandId,
      productionOrderId: params.productionOrderId,
      workStepInstanceId: params.workStepInstanceId,
      completionSubmissionId: params.completionSubmissionId,
      summary: params.summary,
      detail: params.detail as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  await writeAuditEvent(tx, {
    organizationId: params.organizationId,
    eventType: 'sync_conflict.detected',
    resourceType: 'sync_conflict',
    resourceId: conflict.id,
    actorId: params.detectedByUserId,
    newValues: {
      conflictType: params.conflictType,
      workStepInstanceId: params.workStepInstanceId ?? null,
      productionOrderId: params.productionOrderId ?? null,
      summary: params.summary,
    },
    result: 'PARTIAL',
    failureReason: params.conflictType,
    source: 'system',
  });

  await writeOutboxEvent(tx, {
    organizationId: params.organizationId,
    aggregateType: 'sync_conflict',
    aggregateId: conflict.id,
    // docs/05 names this event for the revision case specifically; the other
    // six ride the generic one so a consumer can subscribe to "a person must
    // decide something" without enumerating types.
    eventType:
      params.conflictType === 'REVISION_CONFLICT'
        ? 'revision_conflict.detected'
        : 'sync_conflict.detected',
    payload: {
      conflictId: conflict.id,
      conflictType: params.conflictType,
      productionOrderId: params.productionOrderId ?? null,
      workStepInstanceId: params.workStepInstanceId ?? null,
      summary: params.summary,
    },
  });

  return conflict;
}

export interface ConflictListItem {
  id: string;
  conflictType: ConflictType;
  status: string;
  summary: string;
  detectedAt: Date;
  orderNumber: string | null;
  productionOrderId: string | null;
  workStepInstanceId: string | null;
  stepNumber: number | null;
  stepTitle: string | null;
  availableDecisions: readonly ConflictDecisionType[];
}

export async function listSyncConflicts(
  actor: Actor,
  options: { status?: 'OPEN' | 'RESOLVED' | 'ALL' } = {},
): Promise<ConflictListItem[]> {
  await assertPermission(actor, 'sync_conflict.view');
  const status = options.status ?? 'OPEN';

  return withOrgContext(actor.organizationId, async (tx) => {
    const rows = await tx.syncConflict.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
      include: {
        productionOrder: { select: { id: true, orderNumber: true } },
        workStepInstance: {
          select: { id: true, stepNumber: true, planStep: { select: { title: true } } },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      conflictType: row.conflictType as ConflictType,
      status: row.status,
      summary: row.summary,
      detectedAt: row.detectedAt,
      orderNumber: row.productionOrder?.orderNumber ?? null,
      productionOrderId: row.productionOrderId,
      workStepInstanceId: row.workStepInstanceId,
      stepNumber: row.workStepInstance?.stepNumber ?? null,
      stepTitle: row.workStepInstance?.planStep.title ?? null,
      availableDecisions: DECISIONS_BY_CONFLICT[row.conflictType as ConflictType] ?? [],
    }));
  });
}

export async function getSyncConflict(actor: Actor, conflictId: string) {
  await assertPermission(actor, 'sync_conflict.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const conflict = await tx.syncConflict.findFirst({
      where: { id: conflictId },
      include: {
        productionOrder: {
          select: { id: true, orderNumber: true, serialNumber: true, status: true },
        },
        workStepInstance: {
          select: {
            id: true,
            stepNumber: true,
            status: true,
            planStep: { select: { title: true } },
          },
        },
        syncCommand: {
          select: {
            id: true,
            commandType: true,
            clientTimestamp: true,
            actorId: true,
            deviceId: true,
            payload: true,
          },
        },
        decisions: { orderBy: { decidedAt: 'desc' } },
      },
    });
    if (!conflict) throw new NotFoundError('Synchronisationskonflikt');

    return {
      ...conflict,
      typeLabel:
        CONFLICT_TYPE_LABEL[conflict.conflictType as ConflictType] ?? conflict.conflictType,
      availableDecisions: DECISIONS_BY_CONFLICT[conflict.conflictType as ConflictType] ?? [],
    };
  });
}

export async function countOpenSyncConflicts(actor: Actor): Promise<number> {
  return withOrgContext(actor.organizationId, (tx) =>
    tx.syncConflict.count({ where: { status: 'OPEN' } }),
  );
}
