/**
 * The client's work step vocabulary — docs/06_OFFLINE_SYNC_CONFLICT.md
 * "Client State Machine (Typsicherheit)".
 *
 * This module is the structural half of the central invariant. The server
 * has a status called `COMPLETED` and a transition that produces it; the
 * client has neither. Not "must not use" — does not have. `COMPLETED` is
 * absent from `ClientWorkStepStatus`, so a client-side expression that
 * assigns it does not type-check and does not compile.
 *
 * The three server-confirmed states below exist so a device can DISPLAY what
 * the server decided. They are produced by exactly one function,
 * `applyServerEvent`, which takes a server event as its input. There is no
 * path from a local user action to any of them — which is the difference
 * between "we are careful" and "it cannot happen" (Negativtest #2).
 */

export type ClientWorkStepStatus =
  | 'LOCKED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED_PENDING_SYNC'
  | 'WAITING_FOR_SERVER'
  | 'SKIP_REQUEST_PENDING_SYNC'
  // Read-only projections of server events. Never reachable locally.
  | 'SERVER_CONFIRMED_COMPLETED'
  | 'SERVER_CONFIRMED_REJECTED'
  | 'BLOCKED_BY_SERVER';

export interface LocalWorkStep {
  workStepInstanceId: string;
  productionOrderId: string;
  stepNumber: number;
  title: string;
  status: ClientWorkStepStatus;
  /** Server entity version at the time of the last projection — the
   *  optimistic lock the outbox sends as `baseVersion`. */
  entityVersion: number;
  /** Present only while the step is READY or being worked on: the signed
   *  proof that THIS step was released. Never present for a LOCKED step —
   *  the server does not issue one (see offline-bundle.ts). */
  releaseToken?: string;
  releaseValidUntil?: string;
  localStartedAt?: string;
  localCompletedAt?: string;
  serverConfirmedAt?: string;
  /** Reasons the server gave for rejecting the completion, for docs/07 A6. */
  rejectionReasons?: Array<{ code: string; detail: string }>;
  /** Set when the step is waiting on a conflict decision (docs/07 A8). */
  conflictId?: string;
}

/**
 * Local completeness pre-check — docs/06 "Lokale Vollständigkeitsprüfung
 * (Client-seitig, nur Vorprüfung!)".
 *
 * Note what it does NOT check: whether a measurement is within tolerance,
 * whether a photo's hash matches, whether the document revision is current.
 * Those are server decisions, and a client that pre-empted them would be
 * teaching workers to trust an answer the server may contradict. This checks
 * only presence, so the worker is not sent to the sync queue with an
 * obviously incomplete step.
 */
export interface LocalCompletenessInput {
  requiredChecklistItemIds: readonly string[];
  answeredChecklistItemIds: readonly string[];
  requiredPhotoCounts: ReadonlyArray<{ requirementId: string; minCount: number }>;
  capturedPhotoCountsByRequirement: Readonly<Record<string, number>>;
  requiredCharacteristicIds: readonly string[];
  measuredCharacteristicIds: readonly string[];
  hasConfirmation: boolean;
}

export interface LocalGap {
  code: string;
  detail: string;
}

export function findLocalGaps(input: LocalCompletenessInput): LocalGap[] {
  const gaps: LocalGap[] = [];

  const answered = new Set(input.answeredChecklistItemIds);
  const openChecklist = input.requiredChecklistItemIds.filter((id) => !answered.has(id));
  if (openChecklist.length > 0) {
    gaps.push({
      code: 'CHECKLIST_INCOMPLETE',
      detail: `${openChecklist.length} Checklistenpunkt(e) noch offen.`,
    });
  }

  for (const requirement of input.requiredPhotoCounts) {
    const have = input.capturedPhotoCountsByRequirement[requirement.requirementId] ?? 0;
    if (have < requirement.minCount) {
      gaps.push({
        code: 'PHOTO_MISSING',
        detail: `Es fehlen noch ${requirement.minCount - have} Foto(s).`,
      });
    }
  }

  const measured = new Set(input.measuredCharacteristicIds);
  const openMeasurements = input.requiredCharacteristicIds.filter((id) => !measured.has(id));
  if (openMeasurements.length > 0) {
    gaps.push({
      code: 'MEASUREMENT_MISSING',
      detail: `${openMeasurements.length} Messwert(e) noch nicht erfasst.`,
    });
  }

  if (!input.hasConfirmation) {
    gaps.push({ code: 'CONFIRMATION_MISSING', detail: 'Bestätigung fehlt.' });
  }

  return gaps;
}

export class LocalRequirementsNotMetError extends Error {
  readonly gaps: readonly LocalGap[];
  constructor(gaps: readonly LocalGap[]) {
    super(`Lokale Vorprüfung nicht bestanden: ${gaps.map((g) => g.detail).join(' ')}`);
    this.name = 'LocalRequirementsNotMetError';
    this.gaps = gaps;
  }
}

/**
 * The strongest statement a device may make about a step: "I am finished
 * here." Note the return type — `COMPLETED_PENDING_SYNC`, spelled out, so
 * the compiler enforces that this function cannot drift into producing
 * anything stronger.
 *
 * There is deliberately no `completeWorkStep()` in this module.
 */
export function prepareLocalCompletion(
  step: LocalWorkStep,
  completeness: LocalCompletenessInput,
  clientNow: () => string = () => new Date().toISOString(),
): LocalWorkStep & { status: 'COMPLETED_PENDING_SYNC' } {
  if (step.status !== 'IN_PROGRESS' && step.status !== 'PAUSED') {
    throw new Error(
      `Nur ein laufender Arbeitsschritt kann lokal abgeschlossen werden (Status: ${step.status}).`,
    );
  }
  const gaps = findLocalGaps(completeness);
  if (gaps.length > 0) throw new LocalRequirementsNotMetError(gaps);

  return { ...step, status: 'COMPLETED_PENDING_SYNC', localCompletedAt: clientNow() };
}

export function markSubmitted(step: LocalWorkStep): LocalWorkStep {
  if (step.status !== 'COMPLETED_PENDING_SYNC') return step;
  return { ...step, status: 'WAITING_FOR_SERVER' };
}

export function startLocally(
  step: LocalWorkStep,
  clientNow: () => string = () => new Date().toISOString(),
): LocalWorkStep {
  // The device may only start what the server has already released, and the
  // proof of that release is the token. No token, no start — the same rule
  // the server applies, applied locally so the UI never offers a button that
  // is going to be refused (docs/07 A7).
  if (step.status !== 'READY') {
    throw new Error(`Arbeitsschritt ist nicht freigegeben (Status: ${step.status}).`);
  }
  if (!step.releaseToken) {
    throw new Error('Für diesen Arbeitsschritt liegt keine Serverfreigabe auf diesem Gerät vor.');
  }
  return { ...step, status: 'IN_PROGRESS', localStartedAt: clientNow() };
}

export interface ServerEvent {
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  serverTimestamp: string;
}

/**
 * The ONLY producer of the three server-confirmed states. Every one of them
 * is derived from an event that the server wrote — there is no argument to
 * this function a client could construct from a local user action that would
 * make a step look completed.
 *
 * `work_step.released` is the counterpart that matters for Negativtest #1: a
 * successor leaves LOCKED here and nowhere else. A locally finished
 * predecessor produces no event, therefore unlocks nothing.
 */
export function applyServerEvent(event: ServerEvent, local: LocalWorkStep): LocalWorkStep {
  if (event.aggregateId !== local.workStepInstanceId) return local;

  switch (event.eventType) {
    case 'work_step.released':
      return {
        ...local,
        status: 'READY',
        // The token does not travel in the event — it is fetched separately
        // (POST /work-steps/{id}/release-token). Until then the step is
        // READY but not startable offline, which is the honest state.
        releaseToken: undefined,
        conflictId: undefined,
      };

    case 'work_step.completed':
      return {
        ...local,
        status: 'SERVER_CONFIRMED_COMPLETED',
        serverConfirmedAt: event.serverTimestamp,
        releaseToken: undefined,
        conflictId: undefined,
      };

    case 'work_step.completion_rejected':
      return {
        ...local,
        status: 'SERVER_CONFIRMED_REJECTED',
        serverConfirmedAt: event.serverTimestamp,
        rejectionReasons: Array.isArray(event.payload.reasons)
          ? (event.payload.reasons as Array<{ code: string; detail: string }>)
          : [],
      };

    case 'work_step.blocked':
      return {
        ...local,
        status: 'BLOCKED_BY_SERVER',
        serverConfirmedAt: event.serverTimestamp,
        conflictId:
          typeof event.payload.conflictId === 'string'
            ? event.payload.conflictId
            : local.conflictId,
      };

    case 'work_step.superseded':
      return { ...local, status: 'BLOCKED_BY_SERVER', serverConfirmedAt: event.serverTimestamp };

    default:
      return local;
  }
}

/** What the tablet shows for each state — docs/07 A2 and A7. The locked
 *  wording is prescribed by A7 and must never be softened into something
 *  that suggests waiting will not be necessary. */
export const CLIENT_STATUS_LABEL: Record<ClientWorkStepStatus, string> = {
  LOCKED: '🔒 Gesperrt',
  READY: 'Freigegeben',
  IN_PROGRESS: 'In Arbeit',
  PAUSED: 'Pausiert',
  COMPLETED_PENDING_SYNC: '⏳ Lokal abgeschlossen – Serverfreigabe ausstehend',
  WAITING_FOR_SERVER: '⏳ Wird serverseitig geprüft',
  SKIP_REQUEST_PENDING_SYNC: '⏳ Überspringantrag ausstehend',
  SERVER_CONFIRMED_COMPLETED: '✓ Abgeschlossen (serverseitig bestätigt)',
  SERVER_CONFIRMED_REJECTED: '⚠ Abschluss abgelehnt',
  BLOCKED_BY_SERVER: '⛔ Gesperrt durch den Server',
};

export const LOCKED_EXPLANATION =
  'Für die Freigabe ist eine Verbindung zum Server und eine erfolgreiche Prüfung erforderlich.';

export const PENDING_SYNC_EXPLANATION =
  'Ihre Daten sind sicher gespeichert und werden synchronisiert, sobald eine Verbindung besteht.';

/**
 * Whether the UI may offer a "start" action. A successor whose predecessor
 * is only COMPLETED_PENDING_SYNC is still LOCKED here, so the answer is no —
 * docs/07 A7: "sie darf unter keinen Umständen 'Weiter' oder einen aktiven
 * Button für Schritt 8 zeigen".
 */
export function canStartLocally(step: LocalWorkStep): boolean {
  return step.status === 'READY' && typeof step.releaseToken === 'string';
}
