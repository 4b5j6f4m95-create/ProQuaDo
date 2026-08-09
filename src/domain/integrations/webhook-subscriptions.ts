import { randomBytes } from 'node:crypto';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import { checkWebhookUrl } from '@/lib/integrations/safe-url';
import type { Actor } from '@/domain/shared/actor';

/**
 * Registering and retiring outbound endpoints — docs/10 Phase 6
 * "ERP/Webhook", which the plan marks optional for the MVP.
 *
 * The shape of this is dictated by the absence of a consumer. Nothing here
 * models an ERP: no order schema, no field mapping, no product master. It
 * ships **the events the system already emits**, in the shape the outbox
 * already has. Guessing at somebody else's data model without that somebody
 * in the room produces an interface that has to be thrown away the first
 * time a real integration arrives; forwarding facts we already publish
 * internally does not.
 */

const MAX_SUBSCRIPTIONS_PER_ORGANIZATION = 20;

export interface CreateWebhookSubscriptionCommand {
  actor: Actor;
  name: string;
  url: string;
  /** Empty means every event type — a deliberate choice, not a default that
   *  happens to leak everything. The caller has to pass it explicitly. */
  eventTypes: string[];
}

export interface CreatedWebhookSubscription {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  /** Returned ONCE, at creation. The receiver needs it to verify signatures;
   *  afterwards it is only in the database, and a lost secret is rotated
   *  rather than recovered. */
  secret: string;
}

export async function createWebhookSubscription(
  command: CreateWebhookSubscriptionCommand,
): Promise<CreatedWebhookSubscription> {
  await assertPermission(command.actor, 'integration.manage');

  const name = command.name.trim();
  if (!name) throw new ValidationError('Ein Webhook braucht einen Namen.');

  const check = await checkWebhookUrl(command.url);
  if (!check.ok) {
    throw new ValidationError(`Endpunkt abgelehnt: ${check.detail ?? check.reason}`);
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const existing = await tx.webhookSubscription.count({ where: { isActive: true } });
    if (existing >= MAX_SUBSCRIPTIONS_PER_ORGANIZATION) {
      throw new ValidationError(
        `Es sind bereits ${MAX_SUBSCRIPTIONS_PER_ORGANIZATION} aktive Webhooks registriert.`,
      );
    }

    const duplicate = await tx.webhookSubscription.findFirst({ where: { name } });
    if (duplicate) {
      throw new ValidationError(`Ein Webhook namens „${name}" existiert bereits.`);
    }

    // Where the subscription starts reading. Deliberately the CURRENT end of
    // the stream, not zero: a newly registered endpoint that immediately
    // received every event since the organization was created would be a
    // surprise for the receiver and a stampede for us.
    const latest = await tx.outboxEvent.findFirst({
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const secret = randomBytes(32).toString('base64url');
    const subscription = await tx.webhookSubscription.create({
      data: {
        organizationId: command.actor.organizationId,
        name,
        url: command.url,
        secret,
        eventTypes: command.eventTypes,
        cursor: latest?.sequence ?? 0n,
        createdById: command.actor.userId,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'webhook_subscription.created',
      resourceType: 'webhook_subscription',
      resourceId: subscription.id,
      actorId: command.actor.userId,
      // The URL is recorded because "where did our production data go" is an
      // audit question. The secret never is.
      newValues: { name, url: command.url, eventTypes: command.eventTypes },
      source: 'web',
    });

    return {
      id: subscription.id,
      name: subscription.name,
      url: subscription.url,
      eventTypes: subscription.eventTypes,
      secret,
    };
  });
}

export async function listWebhookSubscriptions(actor: Actor) {
  await assertPermission(actor, 'integration.manage');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.webhookSubscription.findMany({
      orderBy: { createdAt: 'asc' },
      // `secret` is deliberately absent: an endpoint listing is not a place
      // to hand out signing keys, not even to somebody allowed to see it.
      select: {
        id: true,
        name: true,
        url: true,
        eventTypes: true,
        isActive: true,
        cursor: true,
        createdAt: true,
        _count: { select: { deliveries: true } },
      },
    }),
  );
}

/**
 * Deactivates rather than deletes. The delivery history says what left this
 * system and where it went; removing the subscription would take the "where"
 * with it.
 */
export async function deactivateWebhookSubscription(
  actor: Actor,
  subscriptionId: string,
  reason: string,
): Promise<void> {
  await assertPermission(actor, 'integration.manage');

  await withOrgContext(actor.organizationId, async (tx) => {
    const subscription = await tx.webhookSubscription.findFirst({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundError('Webhook');
    if (!subscription.isActive) return;

    await tx.webhookSubscription.update({
      where: { id: subscription.id },
      data: { isActive: false, version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'webhook_subscription.deactivated',
      resourceType: 'webhook_subscription',
      resourceId: subscription.id,
      actorId: actor.userId,
      previousValues: { isActive: true },
      newValues: { isActive: false },
      reason,
      source: 'web',
    });
  });
}
