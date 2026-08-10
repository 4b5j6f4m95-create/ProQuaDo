import { z } from 'zod';

/**
 * The command vocabulary a device may push (docs/05 "Sync Commands").
 *
 * The most important thing about this list is what is NOT on it. There is no
 * `complete_work_step`, no `release_work_step`, no way to state a status at
 * all. A device submits evidence and a completion REQUEST; the server
 * decides. That is the central invariant of docs/06 expressed in the wire
 * format itself — a malicious client cannot even phrase "step 5 is
 * COMPLETED, unlock step 6" (Negativtest #2).
 */
export const SYNC_COMMAND_TYPES = [
  'start_work_step',
  'record_checklist_response',
  'record_measurement_result',
  'complete_photo_upload',
  'submit_completion',
  'raise_non_conformance',
] as const;

export type SyncCommandType = (typeof SYNC_COMMAND_TYPES)[number];

const uuid = z.string().uuid();

export const COMMAND_PAYLOAD_SCHEMAS = {
  start_work_step: z.object({
    workStepInstanceId: uuid,
    releaseToken: z.string().optional(),
  }),
  record_checklist_response: z.object({
    workStepInstanceId: uuid,
    checklistItemId: uuid,
    response: z.enum(['OK', 'NOK', 'N/A']),
    comment: z.string().max(2000).optional(),
  }),
  record_measurement_result: z.object({
    workStepInstanceId: uuid,
    inspectionCharacteristicId: uuid,
    measuredValue: z.string().min(1).max(64),
    measuringEquipmentId: uuid.optional(),
    measuringEquipmentRef: z.string().max(255).optional(),
  }),
  complete_photo_upload: z.object({
    photoEvidenceId: uuid,
    expectedHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  submit_completion: z.object({
    workStepInstanceId: uuid,
    confirmation: z.object({
      signatureMethod: z.enum(['PIN', 'DIGITAL_SIGNATURE']),
      pin: z.string().min(4).max(32),
    }),
    // Captured offline, preserved as-is — docs/06 LocalMutation:
    // "clientTimestamp: Erfassungszeit (bleibt erhalten!)".
    clientCompletedAt: z.coerce.date().optional(),
    // What the device actually had in front of it. This is the input to the
    // revision conflict check (Abnahmeszenario C) and is worthless if the
    // client omits it, so it is required for completions.
    usedDocumentRevisionIds: z.array(uuid),
  }),
  raise_non_conformance: z.object({
    productionOrderId: uuid,
    workStepInstanceId: uuid.optional(),
    description: z.string().min(1).max(4000),
    errorCategory: z.string().max(100).optional(),
    priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
    reporterSuggestsBlocking: z.boolean().optional(),
    discoveredAt: z.coerce.date().optional(),
  }),
} as const satisfies Record<SyncCommandType, z.ZodTypeAny>;

/** The envelope from docs/06 "Lokales Mutation-Envelope". `idempotencyKey`
 *  equals the client's `mutationId` and is reused verbatim across retries —
 *  that is what makes a lost response harmless (Negativtest #3). */
export const syncCommandEnvelopeSchema = z.object({
  idempotencyKey: uuid,
  commandType: z.enum(SYNC_COMMAND_TYPES),
  // Seit zod 4 verlangt `z.record` beide Schemata. Der Schlüsseltyp war
  // vorher implizit `string` — hier steht er nur ausdrücklich, die
  // Nutzlast bleibt unverändert offen und wird erst vom Schema des
  // jeweiligen Kommandotyps geprüft (`SYNC_COMMAND_PAYLOADS` oben).
  payload: z.record(z.string(), z.unknown()),
  clientTimestamp: z.coerce.date(),
  sequenceNumber: z.number().int().positive(),
  /** Optimistic lock: the entity version the device last saw. A mismatch is
   *  ENTITY_VERSION_CONFLICT (Negativtest #13). */
  baseVersion: z.number().int().nonnegative().optional(),
});

export type SyncCommandEnvelope = z.infer<typeof syncCommandEnvelopeSchema>;

export const syncCommandsRequestSchema = z.object({
  deviceId: uuid,
  // docs/05 "Rate Limits & Größenlimits": 500 commands per batch.
  commands: z.array(syncCommandEnvelopeSchema).min(1).max(500),
});
