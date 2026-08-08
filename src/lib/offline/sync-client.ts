import { applyServerEvent, type LocalWorkStep, type ServerEvent } from './client-work-step-status';
import type { LocalDb } from './local-db';
import {
  SEQUENCE_META_KEY,
  createMutation,
  nextSequenceNumber,
  toWireCommand,
  type CreateMutationInput,
  type LocalMutation,
} from './mutation-envelope';
import { uploadBlob } from './resumable-upload';

/**
 * The sync loop — docs/06 "Synchronisationsprotokoll (Sequenzdetails)",
 * steps 1–9, in that order and for the reasons given there.
 *
 * The ordering is not incidental:
 *
 *   health → photos → commands → changes → confirm outbox
 *
 * Photos go BEFORE commands because a completion whose photo evidence has
 * not arrived would be rejected for missing evidence — a self-inflicted
 * failure that costs the worker a round trip. Changes are pulled AFTER
 * commands so the projection reflects what the batch just caused, including
 * a successor that has become READY. And an outbox entry is only dropped
 * after its result has been written locally (step 8), so a crash between
 * receiving and persisting the answer replays the command instead of losing
 * it — which is safe, because the idempotency key makes the replay a no-op.
 */

export interface SyncDeps {
  db: LocalDb;
  deviceId: string;
  actorId: string;
  fetchJson: <T>(input: string, init?: RequestInit) => Promise<T>;
  fetchBinary: <T>(input: string, body: BodyInit, headers: Record<string, string>) => Promise<T>;
  onLog?: (message: string) => void;
}

export interface SyncCommandResponse {
  idempotencyKey: string;
  status: 'ACCEPTED' | 'REJECTED' | 'CONFLICT' | 'DUPLICATE';
  resultingState?: Record<string, unknown>;
  conflictType?: string;
  conflictId?: string;
  errors?: Array<{ code: string; detail: string }>;
}

export interface SyncResult {
  pushed: number;
  accepted: number;
  rejected: number;
  conflicts: number;
  eventsApplied: number;
  cursor: string;
}

export class DeviceRevokedLocally extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceRevokedLocally';
  }
}

const CURSOR_META_KEY = 'sync-cursor';

export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  // 1/2. Health check. A revoked device stops here, and the caller wipes.
  try {
    await deps.fetchJson(`/api/v1/sync/health?deviceId=${encodeURIComponent(deps.deviceId)}`);
  } catch (error) {
    if (isDeviceRevoked(error)) {
      await deps.db.wipe();
      throw new DeviceRevokedLocally(
        'Dieses Gerät wurde gesperrt. Die lokalen Daten wurden gelöscht; bitte neu anmelden.',
      );
    }
    throw error;
  }

  // 5. Photos first — see the module comment.
  await pushPendingBlobs(deps);

  // 3/4. Outbox.
  const outbox = (await deps.db.listOutbox()).filter(
    (m) => m.state === 'PENDING' || m.state === 'IN_FLIGHT',
  );
  const responses = outbox.length > 0 ? await pushCommands(deps, outbox) : [];

  // 6/7. Changes.
  const projection = await pullAndApplyChanges(deps);

  // 8. Only now are confirmed entries dropped.
  const tally = await settleOutbox(deps, outbox, responses);

  return {
    pushed: outbox.length,
    ...tally,
    eventsApplied: projection.applied,
    cursor: projection.cursor,
  };
}

async function pushCommands(
  deps: SyncDeps,
  outbox: LocalMutation[],
): Promise<SyncCommandResponse[]> {
  for (const mutation of outbox) {
    await deps.db.updateOutbox({
      ...mutation,
      state: 'IN_FLIGHT',
      attempts: mutation.attempts + 1,
    });
  }

  const response = await deps.fetchJson<{ results: SyncCommandResponse[] }>(
    '/api/v1/sync/commands',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deps.deviceId, commands: outbox.map(toWireCommand) }),
    },
  );
  return response.results;
}

async function settleOutbox(
  deps: SyncDeps,
  outbox: LocalMutation[],
  responses: SyncCommandResponse[],
): Promise<{ accepted: number; rejected: number; conflicts: number }> {
  const byKey = new Map(responses.map((r) => [r.idempotencyKey, r]));
  let accepted = 0;
  let rejected = 0;
  let conflicts = 0;

  for (const mutation of outbox) {
    const result = byKey.get(mutation.mutationId);
    if (!result) {
      // No answer for this command: leave it PENDING so the next sync
      // resends it. Harmless — the server deduplicates on the key.
      await deps.db.updateOutbox({ ...mutation, state: 'PENDING' });
      continue;
    }

    if (result.status === 'ACCEPTED' || result.status === 'DUPLICATE') {
      accepted++;
      await applyLocalResult(deps, mutation, result);
      await deps.db.removeFromOutbox(mutation.mutationId);
      continue;
    }

    if (result.status === 'CONFLICT') {
      conflicts++;
      // Kept, not deleted: the worker must be able to see what is waiting on
      // a decision (docs/07 A8), and re-sending it would only re-create the
      // same conflict.
      await deps.db.updateOutbox({
        ...mutation,
        state: 'CONFLICT',
        conflictId: result.conflictId,
        lastError: result.errors?.[0]?.detail,
      });
      await markStepConflicted(deps, mutation, result);
      continue;
    }

    rejected++;
    await deps.db.updateOutbox({
      ...mutation,
      state: 'REJECTED',
      lastError: result.errors?.map((e) => e.detail).join(' ') ?? 'Abgelehnt',
    });
    await markStepRejected(deps, mutation, result);
  }

  return { accepted, rejected, conflicts };
}

async function applyLocalResult(
  deps: SyncDeps,
  mutation: LocalMutation,
  result: SyncCommandResponse,
): Promise<void> {
  const stepId = mutation.payload.workStepInstanceId;
  if (typeof stepId !== 'string') return;

  const step = await deps.db.getStep(stepId);
  if (!step) return;

  const version = result.resultingState?.version;
  if (typeof version === 'number') {
    await deps.db.putStep({ ...step, entityVersion: version });
  }
  // The step's STATUS is deliberately not taken from the command result.
  // It comes from the event stream, through applyServerEvent — one path in,
  // so there is no second place where a device could talk itself into
  // believing a step is complete.
}

async function markStepConflicted(
  deps: SyncDeps,
  mutation: LocalMutation,
  result: SyncCommandResponse,
): Promise<void> {
  const stepId = mutation.payload.workStepInstanceId;
  if (typeof stepId !== 'string') return;
  const step = await deps.db.getStep(stepId);
  if (!step) return;

  await deps.db.putStep({
    ...step,
    status: 'BLOCKED_BY_SERVER',
    ...(result.conflictId ? { conflictId: result.conflictId } : {}),
    rejectionReasons: result.errors ?? [],
  });
}

async function markStepRejected(
  deps: SyncDeps,
  mutation: LocalMutation,
  result: SyncCommandResponse,
): Promise<void> {
  const stepId = mutation.payload.workStepInstanceId;
  if (typeof stepId !== 'string' || mutation.commandType !== 'submit_completion') return;
  const step = await deps.db.getStep(stepId);
  if (!step) return;

  await deps.db.putStep({
    ...step,
    status: 'SERVER_CONFIRMED_REJECTED',
    rejectionReasons: result.errors ?? [],
  });
}

async function pullAndApplyChanges(deps: SyncDeps): Promise<{ applied: number; cursor: string }> {
  let cursor = (await deps.db.getMeta<string>(CURSOR_META_KEY)) ?? '0';
  let applied = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await deps.fetchJson<{
      cursor: string;
      hasMore: boolean;
      events: ServerEvent[];
    }>(
      `/api/v1/sync/changes?deviceId=${encodeURIComponent(deps.deviceId)}&cursor=${encodeURIComponent(cursor)}`,
    );

    for (const event of page.events) {
      const step = await deps.db.getStep(event.aggregateId);
      if (!step) continue;
      const next = applyServerEvent(event, step);
      if (next !== step) {
        await deps.db.putStep(next);
        applied++;
      }
      // A newly released step needs its token before it can be started
      // offline. Fetched here rather than carried in the event, because the
      // server only ever hands out a token it has just minted.
      if (event.eventType === 'work_step.released') {
        await fetchReleaseToken(deps, event.aggregateId);
      }
    }

    cursor = page.cursor;
    hasMore = page.hasMore;
    // Persist per page: an interrupted sync resumes where it stopped rather
    // than replaying the whole stream.
    await deps.db.setMeta(CURSOR_META_KEY, cursor);
  }

  return { applied, cursor };
}

async function fetchReleaseToken(deps: SyncDeps, workStepInstanceId: string): Promise<void> {
  try {
    const token = await deps.fetchJson<{ releaseToken: string; validUntil: string | null }>(
      `/api/v1/work-steps/${workStepInstanceId}/release-token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: deps.deviceId }),
      },
    );
    const step = await deps.db.getStep(workStepInstanceId);
    if (!step) return;
    await deps.db.putStep({
      ...step,
      releaseToken: token.releaseToken,
      ...(token.validUntil ? { releaseValidUntil: token.validUntil } : {}),
    });
  } catch (error) {
    // Not fatal: the step stays READY without a token, which simply means it
    // cannot be started until the device is online again. Failing loudly
    // here would abort a sync that has otherwise succeeded.
    deps.onLog?.(`Freigabe-Token für ${workStepInstanceId} konnte nicht geladen werden: ${error}`);
  }
}

async function pushPendingBlobs(deps: SyncDeps): Promise<void> {
  const steps = await deps.db.listSteps();
  for (const step of steps) {
    for (const blob of await deps.db.listBlobs(step.workStepInstanceId)) {
      try {
        await uploadBlob({ ...deps }, blob);
      } catch (error) {
        // One unusable photo must not block the rest of the sync — the
        // completion that depends on it will be rejected for missing
        // evidence, which is the honest outcome and a decidable one.
        deps.onLog?.(`Foto ${blob.id} konnte nicht übertragen werden: ${error}`);
      }
    }
  }
}

/**
 * Enqueue helper: allocates the next monotone sequence number and stores the
 * mutation. Everything a device wants to send goes through here, so the
 * counter has exactly one writer.
 */
export async function enqueueMutation(
  db: LocalDb,
  input: Omit<CreateMutationInput, 'sequenceNumber'>,
): Promise<LocalMutation> {
  const current = await db.getMeta<number>(SEQUENCE_META_KEY);
  const sequenceNumber = nextSequenceNumber(current);
  await db.setMeta(SEQUENCE_META_KEY, sequenceNumber);

  const mutation = createMutation({ ...input, sequenceNumber });
  await db.enqueue(mutation);
  return mutation;
}

function isDeviceRevoked(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'DEVICE_REVOKED'
  );
}

export async function readLocalStep(
  db: LocalDb,
  workStepInstanceId: string,
): Promise<LocalWorkStep | undefined> {
  return db.getStep(workStepInstanceId);
}
