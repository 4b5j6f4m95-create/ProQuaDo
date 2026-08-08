import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { hasPermissionWithin } from '@/lib/authz/permission-within';
import type { Actor } from '@/domain/shared/actor';
import { assertDeviceActive, touchDevice } from './device-registry';

/**
 * `GET /sync/changes` — server → client projection (docs/05 "Sync Changes",
 * docs/06 protocol steps 6–9).
 *
 * The stream a device reads is the outbox, ordered by the commit-ordered
 * sequence from outbox-sequence.ts. Two properties matter more than
 * throughput here:
 *
 *  - No event may be delivered that the user is not entitled to see. RLS
 *    already confines the read to the organization; the assignment filter
 *    below narrows it to the orders this person actually works on
 *    (docs/04 ABAC).
 *  - The cursor advances past events that were filtered out. Otherwise a
 *    device whose next event belongs to somebody else's order would fetch
 *    the same page forever and never reach its own later events.
 */

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

/**
 * Event types a device needs for its local projection. An allowlist rather
 * than "everything in the outbox": the outbox is also the feed for internal
 * consumers (PDF generation, notifications), and a tablet has no business
 * receiving events it cannot act on.
 */
const DEVICE_RELEVANT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'work_step.released',
  'work_step.started',
  'work_step.completed',
  'work_step.completion_rejected',
  'work_step.blocked',
  'work_step.superseded',
  'production_order.released',
  'production_order.completed',
  'production_order.status_changed',
  'non_conformance.raised',
  'non_conformance.closed',
  'production_hold.applied',
  'production_hold.released',
  'second_approval.granted',
  'revision_conflict.detected',
  'sync_conflict.resolved',
  'document_revision.released',
  'document_revision.superseded',
]);

export interface SyncChangeEvent {
  eventId: string;
  cursor: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  serverTimestamp: string;
}

export interface SyncChangesResult {
  cursor: string;
  hasMore: boolean;
  events: SyncChangeEvent[];
}

export interface PullChangesQuery {
  actor: Actor;
  deviceId: string;
  /** Last cursor the device has fully applied. 0 (or absent) means "from the
   *  beginning of what this organization has". */
  cursor?: bigint;
  limit?: number;
}

export async function pullChanges(query: PullChangesQuery): Promise<SyncChangesResult> {
  await assertPermission(query.actor, 'sync.execute');

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  return withOrgContext(query.actor.organizationId, async (tx) => {
    await assertDeviceActive(tx, query.actor, query.deviceId);

    const fromCursor = query.cursor ?? (await readCursor(tx, query.actor, query.deviceId));

    // One row more than the page size, purely to answer hasMore without a
    // second COUNT over the same range.
    const rows = await tx.outboxEvent.findMany({
      where: { sequence: { gt: fromCursor } },
      orderBy: { sequence: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        sequence: true,
        aggregateType: true,
        aggregateId: true,
        eventType: true,
        payload: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const visible = await filterVisibleEvents(tx, query.actor, page);

    // The cursor is the last sequence SCANNED, not the last delivered — see
    // the module comment.
    const newCursor = page.at(-1)?.sequence ?? fromCursor;
    await persistCursor(tx, query.actor, query.deviceId, newCursor);
    await touchDevice(tx, query.deviceId, true);

    return {
      cursor: newCursor.toString(),
      hasMore,
      events: visible.map((row) => ({
        eventId: row.id,
        cursor: row.sequence.toString(),
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        serverTimestamp: row.createdAt.toISOString(),
      })),
    };
  });
}

type OutboxRow = {
  id: string;
  sequence: bigint;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

/**
 * Entitlement filter. Order-bound events are delivered only for orders the
 * actor is assigned to; document events only to someone who may view
 * documents at all. Anything whose relationship to an order cannot be
 * established is dropped — failing closed is the only safe direction for a
 * feed that leaves the building on a tablet.
 */
async function filterVisibleEvents(
  tx: Prisma.TransactionClient,
  actor: Actor,
  rows: OutboxRow[],
): Promise<OutboxRow[]> {
  const relevant = rows.filter((row) => DEVICE_RELEVANT_EVENT_TYPES.has(row.eventType));
  if (relevant.length === 0) return [];

  const assignedOrderIds = new Set(
    (
      await tx.orderAssignment.findMany({
        where: { userId: actor.userId, revokedAt: null },
        select: { productionOrderId: true },
      })
    ).map((a) => a.productionOrderId),
  );

  const orderIdByStepId = await resolveOrderIdsForSteps(tx, relevant);
  const mayViewDocuments = await hasPermissionWithin(tx, actor, 'document.view');

  return relevant.filter((row) => {
    if (row.aggregateType === 'document_revision') return mayViewDocuments;

    const orderId = resolveOrderId(row, orderIdByStepId);
    return orderId !== null && assignedOrderIds.has(orderId);
  });
}

async function resolveOrderIdsForSteps(
  tx: Prisma.TransactionClient,
  rows: OutboxRow[],
): Promise<Map<string, string>> {
  const stepIds = rows
    .filter((row) => row.aggregateType === 'work_step_instance')
    .map((row) => row.aggregateId);
  if (stepIds.length === 0) return new Map();

  const steps = await tx.workStepInstance.findMany({
    where: { id: { in: [...new Set(stepIds)] } },
    select: { id: true, productionOrderId: true },
  });
  return new Map(steps.map((s) => [s.id, s.productionOrderId]));
}

function resolveOrderId(row: OutboxRow, orderIdByStepId: Map<string, string>): string | null {
  if (row.aggregateType === 'production_order') return row.aggregateId;
  if (row.aggregateType === 'work_step_instance') {
    return orderIdByStepId.get(row.aggregateId) ?? payloadOrderId(row);
  }
  return payloadOrderId(row);
}

function payloadOrderId(row: OutboxRow): string | null {
  const payload = row.payload as Record<string, unknown> | null;
  const value = payload?.productionOrderId ?? payload?.orderId;
  return typeof value === 'string' ? value : null;
}

async function readCursor(
  tx: Prisma.TransactionClient,
  actor: Actor,
  deviceId: string,
): Promise<bigint> {
  const cursor = await tx.syncCursor.findFirst({
    where: { userId: actor.userId, deviceId },
    select: { lastCursor: true },
  });
  return cursor?.lastCursor ?? 0n;
}

/**
 * Never moves a cursor backwards. A client is allowed to re-request an older
 * cursor (to rebuild its projection after a local database reset), and doing
 * so must not make the server forget how far it had already delivered.
 */
async function persistCursor(
  tx: Prisma.TransactionClient,
  actor: Actor,
  deviceId: string,
  cursor: bigint,
): Promise<void> {
  const existing = await tx.syncCursor.findFirst({
    where: { userId: actor.userId, deviceId },
    select: { id: true, lastCursor: true },
  });

  if (!existing) {
    await tx.syncCursor.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        deviceId,
        lastCursor: cursor,
        lastSyncAt: new Date(),
      },
    });
    return;
  }

  await tx.syncCursor.update({
    where: { id: existing.id },
    data: {
      lastCursor: cursor > existing.lastCursor ? cursor : existing.lastCursor,
      lastSyncAt: new Date(),
      version: { increment: 1 },
    },
  });
}

export interface SyncHealthResult {
  serverTime: string;
  deviceId: string;
  deviceLabel: string | null;
  deviceStatus: 'ACTIVE';
  userId: string;
  organizationId: string;
  cursor: string;
  /** Conflicts touching this user's work that a person still has to decide —
   *  the device shows them per docs/07 A8 rather than silently retrying. */
  openConflictCount: number;
}

/**
 * `GET /sync/health` — protocol step 1/2. Confirms in one round trip that
 * the session is valid, the device is not revoked, and where the client
 * stands in the stream. A revoked device gets DEVICE_REVOKED here, which is
 * the signal that triggers the local wipe.
 */
export async function checkSyncHealth(actor: Actor, deviceId: string): Promise<SyncHealthResult> {
  await assertPermission(actor, 'sync.execute');

  return withOrgContext(actor.organizationId, async (tx) => {
    const device = await assertDeviceActive(tx, actor, deviceId);
    await touchDevice(tx, deviceId, false);

    const cursor = await readCursor(tx, actor, deviceId);
    const openConflictCount = await tx.syncConflict.count({
      where: { status: 'OPEN', syncCommand: { actorId: actor.userId } },
    });

    return {
      serverTime: new Date().toISOString(),
      deviceId: device.id,
      deviceLabel: device.deviceLabel,
      deviceStatus: 'ACTIVE' as const,
      userId: actor.userId,
      organizationId: actor.organizationId,
      cursor: cursor.toString(),
      openConflictCount,
    };
  });
}
