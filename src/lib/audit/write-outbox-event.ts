import type { Prisma } from '@prisma/client';

/**
 * Writes an outbox event in the same transaction as the domain mutation
 * (Transactional Outbox pattern, see docs/05_API_CONTRACTS.md "Konsistenz
 * und Events"). A separate worker polls `processed = false` rows and
 * publishes them to downstream consumers (notifications, PDF generation,
 * future webhooks) — that worker is Phase 6 scope, not Phase 1.
 */
export interface OutboxEventInput {
  organizationId: string;
  aggregateType: string; // e.g. "work_step_instance"
  aggregateId: string;
  eventType: string; // e.g. "work_step.completed" — matches docs/05_API_CONTRACTS.md catalog
  payload: Record<string, unknown>;
}

export async function writeOutboxEvent(
  tx: Prisma.TransactionClient,
  event: OutboxEventInput,
): Promise<{ id: string }> {
  return tx.outboxEvent.create({
    data: {
      organizationId: event.organizationId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}
