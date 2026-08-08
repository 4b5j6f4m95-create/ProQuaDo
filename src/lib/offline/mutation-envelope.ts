import type { SyncCommandType } from '@/domain/sync/sync-command-types';

/**
 * The local mutation envelope — docs/06 "Lokales Mutation-Envelope".
 *
 * Two fields do the real work here:
 *
 *  `clientTimestamp` is the CAPTURE time and is never overwritten on retry.
 *  docs/06 marks it "(bleibt erhalten!)" for a reason: a measurement taken
 *  at 14:32 that syncs at 17:05 happened at 14:32, and a record that says
 *  otherwise is a falsified quality document.
 *
 *  `mutationId` is both the local key and the idempotency key sent to the
 *  server, reused verbatim on every retry. That is what turns a lost
 *  response from a duplicate into a no-op (Negativtest #3).
 */

export interface LocalMutation {
  mutationId: string;
  deviceId: string;
  actorId: string;
  clientTimestamp: string;
  /** Monotone per device — defines the order the server applies the batch. */
  sequenceNumber: number;
  /** Server entity version the device last saw; the optimistic lock
   *  (Negativtest #13). Omitted for commands that do not target an entity
   *  the device has a version for. */
  baseVersion?: number;
  payloadSchemaVersion: string;
  commandType: SyncCommandType;
  payload: Record<string, unknown>;
  /** Local bookkeeping, never sent. */
  state: 'PENDING' | 'IN_FLIGHT' | 'CONFIRMED' | 'REJECTED' | 'CONFLICT';
  attempts: number;
  lastError?: string;
  conflictId?: string;
}

export const PAYLOAD_SCHEMA_VERSION = '1.0';

export interface CreateMutationInput {
  deviceId: string;
  actorId: string;
  commandType: SyncCommandType;
  payload: Record<string, unknown>;
  sequenceNumber: number;
  baseVersion?: number;
  clientTimestamp?: string;
  mutationId?: string;
}

export function createMutation(input: CreateMutationInput): LocalMutation {
  return {
    mutationId: input.mutationId ?? crypto.randomUUID(),
    deviceId: input.deviceId,
    actorId: input.actorId,
    clientTimestamp: input.clientTimestamp ?? new Date().toISOString(),
    sequenceNumber: input.sequenceNumber,
    ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
    commandType: input.commandType,
    payload: input.payload,
    state: 'PENDING',
    attempts: 0,
  };
}

/** The wire shape of `POST /sync/commands` (docs/05). Note that `state`,
 *  `attempts` and `lastError` do not appear: they are the device's own
 *  bookkeeping and no business of the server's. */
export function toWireCommand(mutation: LocalMutation) {
  return {
    idempotencyKey: mutation.mutationId,
    commandType: mutation.commandType,
    payload: mutation.payload,
    clientTimestamp: mutation.clientTimestamp,
    sequenceNumber: mutation.sequenceNumber,
    ...(mutation.baseVersion !== undefined ? { baseVersion: mutation.baseVersion } : {}),
  };
}

/**
 * Monotone sequence counter. Kept in the local database rather than derived
 * from the outbox contents, because entries leave the outbox once confirmed
 * and a counter derived from what remains would go backwards.
 */
export const SEQUENCE_META_KEY = 'outbox-sequence';

export function nextSequenceNumber(current: number | undefined): number {
  return (current ?? 0) + 1;
}
