import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { hasPermissionWithin } from '@/lib/authz/permission-within';
import { AuthzError } from '@/lib/authz/errors';
import {
  BlockingNonConformanceError,
  DomainError,
  EntityVersionConflictError,
  OrderOnHoldError,
  ProductionHoldActiveError,
  ValidationError,
} from '@/lib/domain-errors';
import { logger } from '@/lib/logger';
import type { Actor } from '@/domain/shared/actor';
import { isAssignedToOrder } from '@/domain/production-orders/order-access';
import { PERMISSION_BY_STEP_KIND } from '@/domain/execution/execution-guards';
import { startWorkStep } from '@/domain/execution/start-work-step';
import {
  recordChecklistResponse,
  recordMeasurementResult,
} from '@/domain/execution/capture-evidence';
import { completePhotoUpload } from '@/domain/execution/photo-evidence';
import { submitWorkStepCompletion } from '@/domain/execution/complete-work-step';
import { raiseNonConformance } from '@/domain/quality/raise-non-conformance';
import { assertDeviceActive, touchDevice } from './device-registry';
import { recordConflictWithin } from './conflicts';
import type { ConflictType } from './conflict-types';
import {
  COMMAND_PAYLOAD_SCHEMAS,
  type SyncCommandEnvelope,
  type SyncCommandType,
} from './sync-command-types';

/**
 * `POST /sync/commands` — the offline outbox arriving at the server
 * (docs/06 protocol steps 3–4, docs/05 "Sync Commands").
 *
 * Four properties this implementation exists to guarantee:
 *
 *  1. **Stable order.** Commands run sequentially in the device's own
 *     sequence order, never in parallel, so causally dependent commands
 *     (checklist answer → completion) cannot overtake each other.
 *  2. **No rollback of successful entries.** Every command is its own
 *     transaction. If command 3 of 5 conflicts, 1 and 2 stay applied and
 *     4–5 are still attempted — a batch is not all-or-nothing.
 *  3. **Deterministic answers.** The same idempotency key returns the same
 *     result forever, because the outcome is persisted in `sync_commands`
 *     (Negativtest #3).
 *  4. **Nothing is silently dropped.** A command that cannot be applied
 *     becomes a REJECTED or CONFLICT row that keeps its payload, and a
 *     conflict becomes a decision for a person (Negativtest #5).
 *
 * What this function never does is trust the device about state. It re-runs
 * every server-side guard from Phases 3 and 4 by calling the SAME domain
 * services the online UI calls — there is no "sync path" that validates less.
 */

export type SyncCommandStatus = 'ACCEPTED' | 'REJECTED' | 'CONFLICT' | 'DUPLICATE';

export interface SyncCommandResult {
  idempotencyKey: string;
  status: SyncCommandStatus;
  resultingState?: Record<string, unknown>;
  conflictType?: ConflictType;
  conflictId?: string;
  conflictDetail?: Record<string, unknown>;
  errors?: Array<{ code: string; detail: string }>;
}

export interface ProcessSyncCommandsParams {
  actor: Actor;
  deviceId: string;
  commands: SyncCommandEnvelope[];
}

export async function processSyncCommands(
  params: ProcessSyncCommandsParams,
): Promise<SyncCommandResult[]> {
  // Deliberately NOT gated on `sync.execute`, unlike pullChanges and the
  // offline bundle. Delivering an outbox is not a privileged action — it is
  // the transport, and refusing it would strand offline-captured work on a
  // tablet forever the moment a role is withdrawn. docs/06 is explicit that
  // such data "bleibt erhalten" and becomes a decision, which requires it to
  // reach the server in the first place (Negativtest #5).
  //
  // Nothing is APPLIED without permission: every command is authorized
  // individually in runPreflight, and one that fails becomes a
  // PERMISSION_REVOKED conflict with its payload intact. Reading — pulling
  // changes, downloading a work package — stays behind `sync.execute`,
  // because that hands data out rather than taking it in.
  await withOrgContext(params.actor.organizationId, async (tx) => {
    await assertDeviceActive(tx, params.actor, params.deviceId);
    await touchDevice(tx, params.deviceId, true);
  });

  const ordered = [...params.commands].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const results: SyncCommandResult[] = [];

  // See BatchVersions: the optimistic lock must not fire on changes this very
  // batch caused.
  const batchVersions: BatchVersions = new Map();

  for (const command of ordered) {
    results.push(await processOne(params.actor, params.deviceId, command, batchVersions));
  }

  // Answer in the order the client sent, so a naive client can zip request
  // and response arrays.
  const byKey = new Map(results.map((r) => [r.idempotencyKey, r]));
  return params.commands
    .map((c) => byKey.get(c.idempotencyKey))
    .filter((r): r is SyncCommandResult => r !== undefined);
}

/**
 * Which entity versions this batch is allowed to be "behind" on, per work
 * step instance: the version the step had when the batch first touched it,
 * plus every version the batch has itself produced since.
 *
 * Without this the offline flow could not complete a single step. A device
 * queues start → checklist → measurement → completion while offline, and every
 * one of those commands carries the same `baseVersion` — the version the
 * device knew when it prepared, because nothing told it otherwise. The first
 * command is applied and raises the server's version; every later command in
 * the same batch then failed the optimistic lock against a change it had
 * caused itself, and the whole session ended in ENTITY_VERSION_CONFLICT.
 *
 * The lock exists to catch "somebody ELSE moved this while you were away"
 * (docs/06, Negativtest #13). A device being unaware of its own immediately
 * preceding command is not that, and treating it as such made the check fire
 * on the one path it was supposed to protect.
 *
 * Found by running the offline flow end-to-end in a browser; the integration
 * tests missed it because they build each command with the version the server
 * actually has, which a real client cannot know.
 */
type BatchVersions = Map<string, Set<number>>;

async function processOne(
  actor: Actor,
  deviceId: string,
  command: SyncCommandEnvelope,
  batchVersions: BatchVersions,
): Promise<SyncCommandResult> {
  // ── Claim ────────────────────────────────────────────────
  // The row is written BEFORE the command runs. A crash between "applied"
  // and "acknowledged" then leaves a PENDING row rather than no trace, and
  // the retry re-executes idempotently instead of being mistaken for a
  // duplicate (Negativtest #14 applied to commands rather than uploads).
  const claim = await claimCommand(actor, deviceId, command);
  if (claim.kind === 'DUPLICATE') return claim.result;

  let outcome: SyncCommandResult;
  try {
    outcome = await executeCommand(actor, deviceId, command, batchVersions);
  } catch (error) {
    outcome = await classifyFailure(actor, command, error);
  }

  await finalizeCommand(actor, claim.commandId, command, outcome, batchVersions);
  return outcome;
}

type Claim =
  { kind: 'CLAIMED'; commandId: string } | { kind: 'DUPLICATE'; result: SyncCommandResult };

async function claimCommand(
  actor: Actor,
  deviceId: string,
  command: SyncCommandEnvelope,
): Promise<Claim> {
  return withOrgContext(actor.organizationId, async (tx) => {
    const existing = await tx.syncCommand.findFirst({
      where: { deviceId, idempotencyKey: command.idempotencyKey },
    });

    if (existing && existing.processedAt !== null) {
      return {
        kind: 'DUPLICATE' as const,
        result: {
          idempotencyKey: command.idempotencyKey,
          // docs/05: a repeat of a successfully processed command answers
          // DUPLICATE with the ORIGINAL outcome, not an error.
          status: 'DUPLICATE' as const,
          resultingState: (existing.resultPayload ?? undefined) as
            Record<string, unknown> | undefined,
          ...(existing.conflictType ? { conflictType: existing.conflictType as ConflictType } : {}),
        },
      };
    }

    if (existing) {
      // Interrupted on a previous attempt — re-run it.
      return { kind: 'CLAIMED' as const, commandId: existing.id };
    }

    const created = await tx.syncCommand.create({
      data: {
        organizationId: actor.organizationId,
        deviceId,
        actorId: actor.userId,
        idempotencyKey: command.idempotencyKey,
        commandType: command.commandType,
        payload: command.payload as Prisma.InputJsonValue,
        clientTimestamp: command.clientTimestamp,
        sequenceNumber: command.sequenceNumber,
        baseVersion: command.baseVersion,
        status: 'PENDING',
      },
      select: { id: true },
    });
    return { kind: 'CLAIMED' as const, commandId: created.id };
  });
}

/**
 * Everything that happens after a command has run: the outcome is persisted,
 * a conflict becomes a row for a person, and the step's resulting version is
 * noted for the rest of the batch.
 *
 * **Why these three share one transaction.** They used to be two, and the
 * second one existed to read a single column. At 200 devices a batch of four
 * commands cost 22.6 database transactions, each with its own `BEGIN`,
 * `set_config` for the tenant context and `COMMIT` — measured against
 * `pg_stat_database`, see notes.md. The version read has no ordering
 * relationship to the outcome write, so keeping them apart bought nothing.
 *
 * What is NOT merged in is `claimCommand`. Its row is deliberately committed
 * *before* the command executes, so that a crash in between leaves a PENDING
 * trace instead of no trace at all; folding it in here would trade that
 * property for a round trip.
 */
async function finalizeCommand(
  actor: Actor,
  commandId: string,
  command: SyncCommandEnvelope,
  outcome: SyncCommandResult,
  batchVersions: BatchVersions,
): Promise<void> {
  const stepId =
    typeof command.payload.workStepInstanceId === 'string'
      ? command.payload.workStepInstanceId
      : undefined;

  const stepVersion = await withOrgContext(actor.organizationId, async (tx) => {
    await tx.syncCommand.update({
      where: { id: commandId },
      data: {
        status: outcome.status,
        conflictType: outcome.conflictType ?? null,
        resultPayload: (outcome.resultingState ?? undefined) as Prisma.InputJsonValue | undefined,
        errorCode: outcome.errors?.[0]?.code ?? null,
        errorMessage: outcome.errors?.[0]?.detail ?? null,
        processedAt: new Date(),
        version: { increment: 1 },
      },
    });

    // Whatever the command did to the step's version, the rest of THIS batch
    // may be unaware of it without that being a conflict. Read here rather
    // than applied here: `batchVersions` is an in-memory map and would not be
    // rolled back with the transaction if the conflict handling below throws.
    const instance = stepId
      ? await tx.workStepInstance.findFirst({ where: { id: stepId }, select: { version: true } })
      : null;

    // A conflict is not an error to be logged and forgotten — it is work for
    // a person, so it becomes a row in the conflict centre. Linked to the
    // command, which still holds the full offline payload.
    //
    // A revision conflict was already opened by the validation that detected
    // it (complete-work-step.ts); it only needs the link to the command that
    // carried the offline data. Opening a second row would split one problem
    // across two decisions.
    if (outcome.conflictId) {
      await tx.syncConflict.update({
        where: { id: outcome.conflictId },
        data: { syncCommandId: commandId, version: { increment: 1 } },
      });
      return instance?.version;
    }

    if (outcome.status === 'CONFLICT' && outcome.conflictType) {
      const conflict = await recordConflictWithin(tx, {
        organizationId: actor.organizationId,
        conflictType: outcome.conflictType,
        summary: outcome.errors?.[0]?.detail ?? outcome.conflictType,
        detail: outcome.conflictDetail ?? {},
        syncCommandId: commandId,
        productionOrderId: outcome.conflictDetail?.productionOrderId as string | undefined,
        workStepInstanceId: outcome.conflictDetail?.workStepInstanceId as string | undefined,
        completionSubmissionId: outcome.conflictDetail?.completionSubmissionId as
          string | undefined,
        detectedByUserId: actor.userId,
      });
      outcome.conflictId = conflict.id;
    }

    return instance?.version;
  });

  // Outside the transaction on purpose — see the comment at the read.
  if (stepId && stepVersion !== undefined) {
    const known = batchVersions.get(stepId) ?? new Set<number>();
    known.add(stepVersion);
    batchVersions.set(stepId, known);
  }
}

// ─────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────

async function executeCommand(
  actor: Actor,
  deviceId: string,
  command: SyncCommandEnvelope,
  batchVersions: BatchVersions,
): Promise<SyncCommandResult> {
  const schema = COMMAND_PAYLOAD_SCHEMAS[command.commandType];
  if (!schema) {
    // The API layer's envelope schema already rejects unknown types, so
    // reaching here means an internal caller invented one. Answered as a
    // plain rejection rather than an internal error: there is nothing wrong
    // with the server, the vocabulary simply does not contain this word —
    // which is exactly how a forged `complete_work_step` dies (Negativtest #2).
    throw new ValidationError(`Unbekannter Kommandotyp „${command.commandType}".`);
  }
  const payload = schema.parse(command.payload);

  // Pre-flight, in one transaction, before anything is mutated: the two
  // conditions that changed *while the device was away* and that must become
  // a human decision rather than a bare error — a revoked permission and a
  // stale entity version.
  const preflight = await runPreflight(actor, command, payload, batchVersions);
  if (preflight) return preflight;

  switch (command.commandType) {
    case 'start_work_step': {
      const p = payload as PayloadOf<'start_work_step'>;
      const instance = await startWorkStepIdempotently(actor, deviceId, command, p);
      return accepted(command, {
        workStepInstanceId: instance.id,
        status: instance.status,
        version: instance.version,
      });
    }

    case 'record_checklist_response': {
      const p = payload as PayloadOf<'record_checklist_response'>;
      const saved = await recordChecklistResponse({
        actor,
        deviceId,
        clientTimestamp: command.clientTimestamp,
        ...p,
      });
      return accepted(command, { checklistResponseId: saved.id, response: saved.response });
    }

    case 'record_measurement_result': {
      const p = payload as PayloadOf<'record_measurement_result'>;
      const saved = await recordMeasurementResult({
        actor,
        deviceId,
        clientTimestamp: command.clientTimestamp,
        ...p,
      });
      return accepted(command, {
        measurementResultId: saved.id,
        isWithinTolerance: saved.isWithinTolerance,
      });
    }

    case 'complete_photo_upload': {
      const p = payload as PayloadOf<'complete_photo_upload'>;
      const evidence = await completePhotoUpload({ actor, deviceId, ...p });
      return accepted(command, {
        photoEvidenceId: evidence.id,
        uploadStatus: evidence.uploadStatus,
      });
    }

    case 'submit_completion': {
      const p = payload as PayloadOf<'submit_completion'>;
      const result = await submitWorkStepCompletion({
        actor,
        deviceId,
        workStepInstanceId: p.workStepInstanceId,
        idempotencyKey: command.idempotencyKey,
        confirmation: p.confirmation,
        clientCompletedAt: p.clientCompletedAt ?? command.clientTimestamp,
        usedDocumentRevisionIds: p.usedDocumentRevisionIds,
      });

      // The revision comparison happens inside server-side validation, not
      // here — see detectRevisionConflictWithin in complete-work-step.ts. It
      // has already blocked the step and opened the conflict; all that is
      // left is to report it in the sync vocabulary and attach the conflict
      // to this command, so the decision screen can show what the device
      // actually sent (Abnahmeszenario C).
      if (result.result === 'REVISION_CONFLICT') {
        return {
          idempotencyKey: command.idempotencyKey,
          status: 'CONFLICT',
          conflictType: 'REVISION_CONFLICT',
          conflictId: result.conflictId,
          conflictDetail: {
            workStepInstanceId: p.workStepInstanceId,
            completionSubmissionId: result.submissionId,
          },
          resultingState: {
            submissionId: result.submissionId,
            workStepStatus: result.workStepStatus,
          },
          errors: result.rejectionReasons.map((r) => ({ code: r.code, detail: r.detail })),
        };
      }

      // A rejected completion is a REJECTED command, not a conflict: nothing
      // is ambiguous, the evidence simply does not satisfy the requirements
      // and the worker has to fix it. The reasons travel back so the tablet
      // can list them (docs/07 A6).
      if (result.result === 'REJECTED') {
        return {
          idempotencyKey: command.idempotencyKey,
          status: 'REJECTED',
          resultingState: {
            submissionId: result.submissionId,
            workStepStatus: result.workStepStatus,
          },
          errors: result.rejectionReasons.map((r) => ({ code: r.code, detail: r.detail })),
        };
      }

      return accepted(command, {
        submissionId: result.submissionId,
        result: result.result,
        workStepStatus: result.workStepStatus,
        nextStepInstanceIds: result.nextStepInstanceIds,
      });
    }

    case 'raise_non_conformance': {
      const p = payload as PayloadOf<'raise_non_conformance'>;
      const ncr = await raiseNonConformance({
        actor,
        deviceId,
        discoveredAt: p.discoveredAt ?? command.clientTimestamp,
        ...p,
      });
      return accepted(command, {
        nonConformanceId: ncr.id,
        ncrNumber: ncr.ncrNumber,
        isBlocking: ncr.isBlocking,
      });
    }
  }
}

type PayloadOf<T extends SyncCommandType> = ReturnType<
  (typeof COMMAND_PAYLOAD_SCHEMAS)[T]['parse']
>;

function accepted(
  command: SyncCommandEnvelope,
  resultingState: Record<string, unknown>,
): SyncCommandResult {
  return { idempotencyKey: command.idempotencyKey, status: 'ACCEPTED', resultingState };
}

/**
 * Starting a step is the one command that is not naturally idempotent: a
 * retry after a lost acknowledgement would hit READY → IN_PROGRESS on an
 * instance that is already IN_PROGRESS. If the same person already started
 * it, the retry has nothing left to do and reports the state as it stands.
 * Somebody ELSE having started it is a genuine conflict and is not
 * swallowed here.
 */
async function startWorkStepIdempotently(
  actor: Actor,
  deviceId: string,
  command: SyncCommandEnvelope,
  payload: PayloadOf<'start_work_step'>,
) {
  const existing = await withOrgContext(actor.organizationId, (tx) =>
    tx.workStepInstance.findFirst({
      where: { id: payload.workStepInstanceId },
      select: { id: true, status: true, version: true, startedById: true },
    }),
  );

  if (
    existing &&
    existing.startedById === actor.userId &&
    (existing.status === 'IN_PROGRESS' || existing.status === 'PAUSED')
  ) {
    return existing;
  }

  return startWorkStep({
    actor,
    deviceId,
    workStepInstanceId: payload.workStepInstanceId,
    releaseToken: payload.releaseToken,
    clientTimestamp: command.clientTimestamp,
  });
}

// ─────────────────────────────────────────────────────────────
// Conflict detection
// ─────────────────────────────────────────────────────────────

/**
 * Checks the two conditions that are specific to time having passed since
 * the device went offline. Everything else (holds, blocking NCRs, evidence
 * integrity, step status) is checked by the domain services themselves and
 * arrives here as a thrown error — see classifyFailure.
 */
async function runPreflight(
  actor: Actor,
  command: SyncCommandEnvelope,
  payload: Record<string, unknown>,
  batchVersions: BatchVersions,
): Promise<SyncCommandResult | null> {
  const workStepInstanceId =
    typeof payload.workStepInstanceId === 'string' ? payload.workStepInstanceId : undefined;

  return withOrgContext(actor.organizationId, async (tx) => {
    const instance = workStepInstanceId
      ? await tx.workStepInstance.findFirst({
          where: { id: workStepInstanceId },
          select: {
            id: true,
            version: true,
            stepKind: true,
            productionOrderId: true,
            stepNumber: true,
          },
        })
      : null;

    // PERMISSION_REVOKED (Negativtest #5). docs/06 is explicit: the captured
    // data is NOT discarded. It stays on the sync command row, and an
    // authorized person decides whether it counts.
    const required = requiredPermissionFor(command.commandType, instance?.stepKind);
    const assignmentOk = instance
      ? await isAssignedToOrder(tx, actor, instance.productionOrderId)
      : true;
    if (!(await hasPermissionWithin(tx, actor, required)) || !assignmentOk) {
      return {
        idempotencyKey: command.idempotencyKey,
        status: 'CONFLICT' as const,
        conflictType: 'PERMISSION_REVOKED' as const,
        conflictDetail: {
          requiredPermission: required,
          commandType: command.commandType,
          workStepInstanceId: instance?.id,
          productionOrderId: instance?.productionOrderId,
          assignmentRevoked: !assignmentOk,
          capturedAt: command.clientTimestamp.toISOString(),
        },
        errors: [
          {
            code: 'PERMISSION_REVOKED',
            detail:
              'Berechtigung wurde vor der Synchronisation entzogen. Die erfassten Daten bleiben ' +
              'erhalten, erfordern aber eine Entscheidung durch eine berechtigte Person.',
          },
        ],
      };
    }

    // ENTITY_VERSION_CONFLICT (Negativtest #13): two devices synced work on
    // the same step, or somebody moved it on the server in between.
    //
    // "In between" excludes this batch's own earlier commands — see
    // BatchVersions. The first time the batch touches a step, its current
    // version becomes acceptable; every version the batch then produces is
    // added.
    if (instance) {
      const known = batchVersions.get(instance.id);
      if (!known) batchVersions.set(instance.id, new Set([instance.version]));
    }
    const acceptableVersions = instance ? batchVersions.get(instance.id) : undefined;

    if (
      instance &&
      command.baseVersion !== undefined &&
      !(acceptableVersions?.has(command.baseVersion) ?? false)
    ) {
      return {
        idempotencyKey: command.idempotencyKey,
        status: 'CONFLICT' as const,
        conflictType: 'ENTITY_VERSION_CONFLICT' as const,
        conflictDetail: {
          workStepInstanceId: instance.id,
          productionOrderId: instance.productionOrderId,
          clientVersion: command.baseVersion,
          serverVersion: instance.version,
        },
        errors: [
          {
            code: 'ENTITY_VERSION_CONFLICT',
            detail: `Der Arbeitsschritt wurde zwischenzeitlich geändert (Gerät kannte v${command.baseVersion}, Server hat v${instance.version}).`,
          },
        ],
      };
    }

    return null;
  });
}

/**
 * Maps an exception thrown by a domain service onto the sync vocabulary.
 * The distinction that matters: a condition that will pass later, or that
 * needs a human, becomes CONFLICT; a condition that is simply wrong becomes
 * REJECTED. Both keep the payload.
 */
async function classifyFailure(
  actor: Actor,
  command: SyncCommandEnvelope,
  error: unknown,
): Promise<SyncCommandResult> {
  const base = { idempotencyKey: command.idempotencyKey };
  const workStepInstanceId =
    typeof command.payload.workStepInstanceId === 'string'
      ? command.payload.workStepInstanceId
      : undefined;
  const productionOrderId =
    typeof command.payload.productionOrderId === 'string'
      ? command.payload.productionOrderId
      : await resolveOrderId(actor, workStepInstanceId);

  const anchor = { workStepInstanceId, productionOrderId };

  if (error instanceof BlockingNonConformanceError) {
    return {
      ...base,
      status: 'CONFLICT',
      conflictType: 'BLOCKING_NCR',
      conflictDetail: anchor,
      errors: [{ code: error.code, detail: error.message }],
    };
  }

  if (error instanceof OrderOnHoldError || error instanceof ProductionHoldActiveError) {
    return {
      ...base,
      status: 'CONFLICT',
      conflictType: 'ORDER_ON_HOLD',
      conflictDetail: anchor,
      errors: [{ code: error.code, detail: error.message }],
    };
  }

  if (error instanceof EntityVersionConflictError) {
    return {
      ...base,
      status: 'CONFLICT',
      conflictType: 'ENTITY_VERSION_CONFLICT',
      conflictDetail: anchor,
      errors: [{ code: error.code, detail: error.message }],
    };
  }

  // A hash mismatch or a missing object is the evidence itself being
  // unusable — the device has to send it again (docs/06
  // MISSING_OR_CORRUPT_EVIDENCE → REQUEST_REUPLOAD).
  if (error instanceof DomainError && error.code === 'MISSING_OR_CORRUPT_EVIDENCE') {
    return {
      ...base,
      status: 'CONFLICT',
      conflictType: 'MISSING_OR_CORRUPT_EVIDENCE',
      conflictDetail: {
        ...anchor,
        photoEvidenceId: command.payload.photoEvidenceId,
      },
      errors: [{ code: error.code, detail: error.message }],
    };
  }
  if (
    command.commandType === 'complete_photo_upload' &&
    error instanceof ValidationError &&
    /Hash|Upload|Virenscan/i.test(error.message)
  ) {
    return {
      ...base,
      status: 'CONFLICT',
      conflictType: 'MISSING_OR_CORRUPT_EVIDENCE',
      conflictDetail: { ...anchor, photoEvidenceId: command.payload.photoEvidenceId },
      errors: [{ code: 'MISSING_OR_CORRUPT_EVIDENCE', detail: error.message }],
    };
  }

  if (error instanceof AuthzError) {
    return {
      ...base,
      status: 'CONFLICT',
      conflictType: 'PERMISSION_REVOKED',
      conflictDetail: anchor,
      errors: [{ code: error.code, detail: error.message }],
    };
  }

  if (error instanceof DomainError) {
    return {
      ...base,
      status: 'REJECTED',
      errors: [{ code: error.code, detail: error.message }],
    };
  }

  // Anything unrecognized is a server fault, not a client one. Reported as
  // REJECTED so the batch continues, and logged with the command so it can
  // be reconstructed — the row itself keeps the payload either way.
  logger.error(
    { err: error, commandType: command.commandType, idempotencyKey: command.idempotencyKey },
    'sync command failed unexpectedly',
  );
  return {
    ...base,
    status: 'REJECTED',
    errors: [
      {
        code: 'INTERNAL_ERROR',
        detail: 'Das Kommando konnte serverseitig nicht verarbeitet werden.',
      },
    ],
  };
}

async function resolveOrderId(
  actor: Actor,
  workStepInstanceId: string | undefined,
): Promise<string | undefined> {
  if (!workStepInstanceId) return undefined;
  const instance = await withOrgContext(actor.organizationId, (tx) =>
    tx.workStepInstance.findFirst({
      where: { id: workStepInstanceId },
      select: { productionOrderId: true },
    }),
  );
  return instance?.productionOrderId;
}

function requiredPermissionFor(commandType: SyncCommandType, stepKind: string | undefined) {
  if (commandType === 'raise_non_conformance') return 'ncr.create' as const;
  if (commandType === 'submit_completion' && (stepKind ?? 'PRODUCTION') === 'PRODUCTION') {
    return 'work_step.complete_locally' as const;
  }
  return PERMISSION_BY_STEP_KIND[stepKind ?? 'PRODUCTION'] ?? ('work_step.execute' as const);
}
