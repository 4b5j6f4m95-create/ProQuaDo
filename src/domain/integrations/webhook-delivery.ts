import { withOrgContext } from '@/lib/db/tenant-context';
import { logger } from '@/lib/logger';
import { checkWebhookUrl } from '@/lib/integrations/safe-url';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signWebhookPayload,
} from '@/lib/integrations/webhook-signature';
import type { Actor } from '@/domain/shared/actor';

/**
 * Turning outbox events into outbound deliveries, and making the attempts.
 *
 * ## Why there is no worker
 *
 * ADR-007 keeps queue infrastructure out of the MVP, and notifications
 * therefore dispatch when somebody reads them. That trick does not carry
 * over: an external system cannot wait for a person to open a page. So
 * dispatch is an explicit, authenticated trigger — `POST
 * /api/v1/integrations/webhooks/dispatch` — that a scheduler calls. No new
 * component in the application, one line in whatever already runs cron.
 *
 * Stated plainly because it is a deployment requirement, not a detail: with
 * nothing calling that endpoint, nothing is ever delivered. See ADR-008.
 *
 * ## Two phases, on purpose
 *
 * `enqueueDueDeliveries` reads the outbox and writes delivery rows. `attempt`
 * makes HTTP requests. Keeping them apart is what makes a crash mid-run
 * harmless: enumeration is idempotent through the unique index, and an
 * attempt that dies before recording its outcome is simply retried.
 */

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 200;
const REQUEST_TIMEOUT_MS = 10_000;
/** Longest wait between attempts. Roughly six hours total across the six
 *  attempts — long enough to ride out a receiver's maintenance window,
 *  short enough that the failure is noticed the same day. */
const MAX_BACKOFF_SECONDS = 60 * 60;

/** 1 min, 5, 25, … capped. Exported so the shape is testable without a
 *  network — the same reasoning as the PIN lockout backoff. */
export function backoffSecondsForAttempt(attempt: number): number {
  return Math.min(60 * 5 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS);
}

export interface DispatchResult {
  enqueued: number;
  delivered: number;
  failed: number;
  retryScheduled: number;
}

export async function dispatchWebhooks(actor: Actor): Promise<DispatchResult> {
  const enqueued = await enqueueDueDeliveries(actor);
  const outcome = await attemptDueDeliveries(actor);
  return { enqueued, ...outcome };
}

/**
 * Reads each active subscription's slice of the outbox and records what it
 * should receive.
 *
 * The cursor advances past events that were filtered out — the same rule the
 * device sync follows, and for the same reason: a subscription narrowed to
 * one event type would otherwise re-scan the same rows forever and never
 * reach its own later events.
 */
export async function enqueueDueDeliveries(actor: Actor): Promise<number> {
  return withOrgContext(actor.organizationId, async (tx) => {
    const subscriptions = await tx.webhookSubscription.findMany({ where: { isActive: true } });
    let created = 0;

    for (const subscription of subscriptions) {
      const events = await tx.outboxEvent.findMany({
        where: { sequence: { gt: subscription.cursor } },
        orderBy: { sequence: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, sequence: true, eventType: true },
      });
      if (events.length === 0) continue;

      const wanted =
        subscription.eventTypes.length === 0
          ? events
          : events.filter((event) => subscription.eventTypes.includes(event.eventType));

      if (wanted.length > 0) {
        const result = await tx.webhookDelivery.createMany({
          data: wanted.map((event) => ({
            organizationId: actor.organizationId,
            subscriptionId: subscription.id,
            outboxEventId: event.id,
            eventType: event.eventType,
          })),
          // The unique index is the idempotency; a re-run after a crash
          // between writing rows and advancing the cursor must not fail.
          skipDuplicates: true,
        });
        created += result.count;
      }

      const lastScanned = events[events.length - 1];
      if (lastScanned) {
        await tx.webhookSubscription.update({
          where: { id: subscription.id },
          data: { cursor: lastScanned.sequence, version: { increment: 1 } },
        });
      }
    }

    return created;
  });
}

async function attemptDueDeliveries(
  actor: Actor,
): Promise<{ delivered: number; failed: number; retryScheduled: number }> {
  const due = await withOrgContext(actor.organizationId, (tx) =>
    tx.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      include: { subscription: true },
    }),
  );

  let delivered = 0;
  let failed = 0;
  let retryScheduled = 0;

  for (const row of due) {
    if (!row.subscription.isActive) {
      // Deactivated after the row was written. Not an error and not a
      // delivery — recorded so the history says why it stopped.
      await recordFailure(actor, row.id, row.attempts, 'SUBSCRIPTION_DEACTIVATED', null, true);
      failed++;
      continue;
    }

    const event = await withOrgContext(actor.organizationId, (tx) =>
      tx.outboxEvent.findFirst({ where: { id: row.outboxEventId } }),
    );
    if (!event) {
      await recordFailure(actor, row.id, row.attempts, 'EVENT_NOT_FOUND', null, true);
      failed++;
      continue;
    }

    const body = JSON.stringify({
      deliveryId: row.id,
      eventId: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      sequence: event.sequence.toString(),
      occurredAt: event.createdAt.toISOString(),
      payload: event.payload,
    });

    const outcome = await deliver(row.subscription.url, row.subscription.secret, body, {
      eventType: event.eventType,
      deliveryId: row.id,
    });

    const attempts = row.attempts + 1;
    if (outcome.ok) {
      await withOrgContext(actor.organizationId, (tx) =>
        tx.webhookDelivery.update({
          where: { id: row.id },
          data: {
            status: 'DELIVERED',
            attempts,
            lastAttemptAt: new Date(),
            responseStatus: outcome.status ?? null,
            deliveredAt: new Date(),
          },
        }),
      );
      delivered++;
      continue;
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    await recordFailure(
      actor,
      row.id,
      row.attempts,
      outcome.reason,
      outcome.status ?? null,
      exhausted,
    );
    if (exhausted) failed++;
    else retryScheduled++;
  }

  return { delivered, failed, retryScheduled };
}

async function recordFailure(
  actor: Actor,
  deliveryId: string,
  previousAttempts: number,
  reason: string,
  responseStatus: number | null,
  terminal: boolean,
): Promise<void> {
  const attempts = previousAttempts + 1;
  await withOrgContext(actor.organizationId, (tx) =>
    tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        attempts,
        lastAttemptAt: new Date(),
        responseStatus,
        failureReason: reason,
        nextAttemptAt: terminal
          ? new Date()
          : new Date(Date.now() + backoffSecondsForAttempt(attempts) * 1000),
      },
    }),
  );
}

type DeliveryOutcome =
  { ok: true; status: number } | { ok: false; status?: number; reason: string };

async function deliver(
  url: string,
  secret: string,
  body: string,
  meta: { eventType: string; deliveryId: string },
): Promise<DeliveryOutcome> {
  // Re-checked at delivery, not only at registration: DNS moves, and the
  // address that mattered when somebody typed the URL is not necessarily the
  // one we are about to POST production data to.
  const check = await checkWebhookUrl(url);
  if (!check.ok) {
    return { ok: false, reason: `URL_REJECTED:${check.reason}` };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signWebhookPayload(secret, timestamp, body),
        [TIMESTAMP_HEADER]: timestamp,
        [EVENT_HEADER]: meta.eventType,
        [DELIVERY_HEADER]: meta.deliveryId,
      },
      body,
      // Redirects are not followed: a 302 into the internal network would
      // walk straight around the address check above.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status };
    }
    return { ok: false, status: response.status, reason: `HTTP_${response.status}` };
  } catch (error) {
    logger.warn({ err: error, url }, 'webhook delivery failed');
    return { ok: false, reason: error instanceof Error ? error.name : 'REQUEST_FAILED' };
  }
}

export async function listWebhookDeliveries(actor: Actor, subscriptionId?: string) {
  return withOrgContext(actor.organizationId, (tx) =>
    tx.webhookDelivery.findMany({
      where: subscriptionId ? { subscriptionId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  );
}
