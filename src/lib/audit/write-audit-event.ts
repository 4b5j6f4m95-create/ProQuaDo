import type { Prisma } from '@prisma/client';

/**
 * Writes an audit event. MUST be called with the same transaction client
 * (`tx`) used for the accompanying domain mutation, inside the same
 * withOrgContext() call — see docs/03_STATE_MACHINES.md "Implementation
 * Guidelines" and Geschäftsgrundsatz 8 in MASTERPROMPT.md. This is what
 * makes "audit and business change are atomic" true rather than aspirational.
 *
 * Audit rows are append-only: the database grants (see migration
 * 20260808151300_rls_and_audit_hardening) deny UPDATE/DELETE to the
 * application role regardless of what this function does.
 */
export interface AuditEventInput {
  organizationId: string;
  eventType: string; // e.g. "work_step.started" — past tense, dot-namespaced
  resourceType: string; // e.g. "work_step_instance"
  resourceId?: string;
  actorId?: string;
  delegatedActorId?: string;
  correlationId?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  reason?: string;
  source?: 'web' | 'mobile' | 'api' | 'import' | 'system';
  deviceId?: string;
  clientTimestamp?: Date;
  result?: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  failureReason?: string;
  requestId?: string;
  idempotencyKey?: string;
}

export async function writeAuditEvent(
  tx: Prisma.TransactionClient,
  event: AuditEventInput,
): Promise<{ id: string }> {
  const created = await tx.auditEvent.create({
    data: {
      organizationId: event.organizationId,
      eventType: event.eventType,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      actorId: event.actorId,
      delegatedActorId: event.delegatedActorId,
      correlationId: event.correlationId,
      previousValues: toJsonInput(event.previousValues),
      newValues: toJsonInput(event.newValues),
      reason: event.reason,
      source: event.source,
      deviceId: event.deviceId,
      clientTimestamp: event.clientTimestamp,
      result: event.result ?? 'SUCCESS',
      failureReason: event.failureReason,
      requestId: event.requestId,
      idempotencyKey: event.idempotencyKey,
    },
    select: { id: true },
  });

  return created;
}

// Redacts obvious secret-shaped fields before they ever reach the audit
// table. This is a safety net, not a substitute for callers not passing
// secrets in the first place (see 08_THREAT_MODEL_PRIVACY.md).
const SECRET_FIELD_PATTERN = /(password|secret|token|pin|apikey|api_key)/i;

function toJsonInput(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  const redacted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    redacted[key] = SECRET_FIELD_PATTERN.test(key) ? '[REDACTED]' : val;
  }
  return redacted as Prisma.InputJsonValue;
}
