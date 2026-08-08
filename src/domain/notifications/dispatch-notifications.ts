import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { logger } from '@/lib/logger';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';

/**
 * In-app notifications, derived from the transactional outbox — docs/10
 * Phase 6 "Benachrichtigungen: In-App, Event-getrieben".
 *
 * This is the consumer the outbox was built for. `write-outbox-event.ts` has
 * said so since Phase 1: "A separate worker polls `processed = false` rows
 * and publishes them to downstream consumers (notifications, PDF generation,
 * future webhooks)". The `processed` flag is that worker's watermark; the
 * device sync stream uses `sequence` instead and is unaffected by it.
 *
 * There is no worker process (ADR-007: no queue infrastructure in the MVP),
 * so dispatch runs when someone reads their notifications. That is late but
 * never wrong — nothing depends on a notification for correctness, and the
 * unique key on (organization, user, sourceEvent) makes repeated dispatch a
 * no-op rather than a duplicate.
 */

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

type Audience =
  /** Everyone assigned to the order the event belongs to. */
  | { kind: 'ORDER_ASSIGNEES' }
  /** Everyone who holds a permission — the people who can actually act. */
  | { kind: 'PERMISSION'; permission: PermissionCode };

interface NotificationRule {
  severity: NotificationSeverity;
  audience: Audience;
  title: string;
  /** Built from the event payload; kept short enough to read on a tablet. */
  body: (payload: Record<string, unknown>) => string;
  link: (event: { aggregateId: string; payload: Record<string, unknown> }) => string | null;
}

/**
 * Which events become notifications, and for whom.
 *
 * Deliberately a short list. Every event in here interrupts somebody, and a
 * notification centre that fills with routine progress is one nobody reads —
 * which costs exactly the conflicts and blocks it exists to surface.
 */
const RULES: Record<string, NotificationRule> = {
  'work_step.released': {
    severity: 'INFO',
    audience: { kind: 'ORDER_ASSIGNEES' },
    title: 'Arbeitsschritt freigegeben',
    body: (payload) => `Schritt ${payload.stepNumber ?? '—'} wurde zur Ausführung freigegeben.`,
    link: (event) => `/work-steps/${event.aggregateId}`,
  },
  'work_step.completion_rejected': {
    severity: 'WARNING',
    audience: { kind: 'ORDER_ASSIGNEES' },
    title: 'Abschluss abgelehnt',
    body: (payload) => {
      const reasons = Array.isArray(payload.reasons)
        ? (payload.reasons as Array<{ detail?: string }>)
        : [];
      return reasons.length > 0
        ? reasons
            .map((r) => r.detail)
            .filter(Boolean)
            .join(' ')
        : 'Der Abschluss wurde serverseitig abgelehnt.';
    },
    link: (event) => `/work-steps/${event.aggregateId}`,
  },
  'non_conformance.raised': {
    severity: 'CRITICAL',
    audience: { kind: 'PERMISSION', permission: 'ncr.assess' },
    title: 'Abweichung gemeldet',
    body: (payload) =>
      `${payload.ncrNumber ?? 'Abweichung'} — ${payload.isBlocking ? 'blockierend' : 'nicht blockierend'}. Bewertung erforderlich.`,
    link: (event) => `/quality/ncrs/${event.aggregateId}`,
  },
  'production_hold.applied': {
    severity: 'CRITICAL',
    audience: { kind: 'PERMISSION', permission: 'production_hold.release' },
    title: 'Produktionssperre gesetzt',
    body: (payload) => String(payload.holdReason ?? 'Eine Sperre wurde gesetzt.'),
    link: () => null,
  },
  'revision_conflict.detected': {
    severity: 'CRITICAL',
    audience: { kind: 'PERMISSION', permission: 'sync_conflict.decide' },
    title: 'Revisionskonflikt zu entscheiden',
    body: (payload) => String(payload.summary ?? 'Ein Revisionskonflikt wartet auf Entscheidung.'),
    link: (event) => `/sync/conflicts/${event.aggregateId}`,
  },
  'sync_conflict.detected': {
    severity: 'WARNING',
    audience: { kind: 'PERMISSION', permission: 'sync_conflict.decide' },
    title: 'Synchronisationskonflikt zu entscheiden',
    body: (payload) => String(payload.summary ?? 'Ein Konflikt wartet auf Entscheidung.'),
    link: (event) => `/sync/conflicts/${event.aggregateId}`,
  },
  'production_order.completed': {
    severity: 'INFO',
    audience: { kind: 'ORDER_ASSIGNEES' },
    title: 'Auftrag abgeschlossen',
    body: () => 'Alle Arbeitsschritte sind serverseitig bestätigt.',
    link: (event) => `/production-orders/${event.aggregateId}`,
  },
};

/** One batch per call. Bounded so a long-idle installation does not turn the
 *  first page load after the weekend into a full-table scan. */
const BATCH_SIZE = 200;

export async function dispatchPendingNotifications(organizationId: string): Promise<number> {
  return withOrgContext(organizationId, async (tx) => {
    const events = await tx.outboxEvent.findMany({
      where: { processed: false },
      orderBy: { sequence: 'asc' },
      take: BATCH_SIZE,
    });
    if (events.length === 0) return 0;

    let created = 0;
    for (const event of events) {
      const rule = RULES[event.eventType];
      if (rule) {
        try {
          created += await fanOut(tx, organizationId, event, rule);
        } catch (error) {
          // A notification that cannot be built must not stop the outbox from
          // draining, and must not be retried forever: the event is marked
          // processed below either way. Losing a notification is survivable;
          // a stuck outbox is not.
          logger.warn(
            { err: error, eventId: event.id, eventType: event.eventType },
            'notification fan-out failed',
          );
        }
      }

      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { processed: true, processedAt: new Date() },
      });
    }

    return created;
  });
}

async function fanOut(
  tx: Prisma.TransactionClient,
  organizationId: string,
  event: { id: string; eventType: string; aggregateId: string; payload: Prisma.JsonValue },
  rule: NotificationRule,
): Promise<number> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const recipients = await resolveRecipients(tx, organizationId, event, rule.audience, payload);
  if (recipients.length === 0) return 0;

  const link = rule.link({ aggregateId: event.aggregateId, payload });

  const result = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      organizationId,
      userId,
      eventType: event.eventType,
      title: rule.title,
      body: rule.body(payload).slice(0, 500),
      severity: rule.severity,
      resourceType: event.eventType.split('.')[0] ?? null,
      resourceId: event.aggregateId,
      linkPath: link,
      sourceEventId: event.id,
    })),
    // The unique key already guarantees one notification per user and event;
    // skipping duplicates makes a repeated dispatch silent instead of fatal.
    skipDuplicates: true,
  });

  return result.count;
}

async function resolveRecipients(
  tx: Prisma.TransactionClient,
  organizationId: string,
  event: { aggregateId: string },
  audience: Audience,
  payload: Record<string, unknown>,
): Promise<string[]> {
  if (audience.kind === 'PERMISSION') {
    const grants = await tx.userRole.findMany({
      where: {
        organizationId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        role: { rolePermissions: { some: { permission: { code: audience.permission } } } },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return grants.map((grant) => grant.userId);
  }

  const orderId =
    typeof payload.productionOrderId === 'string'
      ? payload.productionOrderId
      : typeof payload.orderId === 'string'
        ? payload.orderId
        : await resolveOrderIdFromAggregate(tx, event.aggregateId);
  if (!orderId) return [];

  const assignments = await tx.orderAssignment.findMany({
    where: { productionOrderId: orderId, revokedAt: null },
    select: { userId: true },
    distinct: ['userId'],
  });
  return assignments.map((assignment) => assignment.userId);
}

async function resolveOrderIdFromAggregate(
  tx: Prisma.TransactionClient,
  aggregateId: string,
): Promise<string | null> {
  const order = await tx.productionOrder.findFirst({
    where: { id: aggregateId },
    select: { id: true },
  });
  if (order) return order.id;

  const instance = await tx.workStepInstance.findFirst({
    where: { id: aggregateId },
    select: { productionOrderId: true },
  });
  return instance?.productionOrderId ?? null;
}
