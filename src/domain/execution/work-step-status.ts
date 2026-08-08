// Matches docs/03_STATE_MACHINES.md §2 "Work Step Instance Status Machine".
//
// This is the SERVER's vocabulary and it is deliberately larger than the
// client's: docs/06_OFFLINE_SYNC_CONFLICT.md restricts the client type to
// states a device may produce, and `COMPLETED` is not among them. Only
// validateAndCompleteWorkStep() may move an instance into COMPLETED, and it
// does so from VALIDATING after re-checking every condition server-side.
export type WorkStepStatus =
  | 'LOCKED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED_PENDING_SYNC'
  | 'WAITING_FOR_SERVER'
  | 'VALIDATING'
  | 'AWAITING_SECOND_APPROVAL'
  | 'COMPLETED'
  | 'COMPLETION_REJECTED'
  | 'BLOCKED'
  | 'SKIP_REQUESTED'
  | 'SKIPPED'
  | 'REWORK_REQUIRED'
  | 'SUPERSEDED';

const VALID_TRANSITIONS: Record<WorkStepStatus, readonly WorkStepStatus[]> = {
  LOCKED: ['READY', 'BLOCKED', 'SUPERSEDED'],
  READY: ['IN_PROGRESS', 'LOCKED', 'BLOCKED', 'SKIP_REQUESTED', 'SUPERSEDED'],
  IN_PROGRESS: [
    'PAUSED',
    // COMPLETED_PENDING_SYNC is the offline path (Phase 5): the device
    // marks it locally and syncs later. Online, the submission goes
    // straight to VALIDATING — same server validation either way.
    'COMPLETED_PENDING_SYNC',
    'VALIDATING',
    'LOCKED',
    'BLOCKED',
    'SKIP_REQUESTED',
    'REWORK_REQUIRED',
    'SUPERSEDED',
  ],
  PAUSED: ['IN_PROGRESS', 'BLOCKED', 'SUPERSEDED'],
  COMPLETED_PENDING_SYNC: ['WAITING_FOR_SERVER'],
  WAITING_FOR_SERVER: ['VALIDATING'],
  // BLOCKED is reachable from VALIDATING since Phase 4: validation is
  // exactly where an out-of-tolerance measurement is turned into a blocking
  // NCR (Abnahmeszenario D). The step is then not merely "rejected", it is
  // held by quality — same event as IN_PROGRESS → BLOCKED, one moment later.
  VALIDATING: ['COMPLETED', 'COMPLETION_REJECTED', 'AWAITING_SECOND_APPROVAL', 'BLOCKED'],
  AWAITING_SECOND_APPROVAL: ['COMPLETED', 'COMPLETION_REJECTED'],
  // Deliberate addition beyond docs/03: the documented machine has no exit
  // from COMPLETION_REJECTED, which would leave a step (and therefore the
  // whole order) permanently stuck after one failed validation. A rejected
  // completion returns the step to IN_PROGRESS so the worker can fix the
  // gap and resubmit; the rejected submission itself stays as a historical
  // record with its reasons.
  COMPLETION_REJECTED: ['IN_PROGRESS'],
  // COMPLETED and SUPERSEDED are reachable from BLOCKED since Phase 5, and
  // only through a recorded conflict decision (src/domain/sync/decide-conflict.ts):
  // "Weiterhin gültig" completes the step with its original revision
  // reference, "Wiederholung erforderlich" retires it in favour of a fresh
  // attempt. Both are docs/06 outcomes of a REVISION_CONFLICT; neither is
  // reachable from a device.
  BLOCKED: ['IN_PROGRESS', 'REWORK_REQUIRED', 'COMPLETED', 'SUPERSEDED'],
  SKIP_REQUESTED: ['SKIPPED', 'IN_PROGRESS'],
  REWORK_REQUIRED: ['IN_PROGRESS'],
  COMPLETED: [],
  SKIPPED: [],
  SUPERSEDED: [],
};

export function isValidWorkStepTransition(from: WorkStepStatus, to: WorkStepStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * A predecessor counts as "done" for successor release purposes. SKIPPED
 * counts because an approved skip is a decision that the step will not be
 * performed — the successor must not wait forever on it. Everything else,
 * including COMPLETED_PENDING_SYNC, does NOT count: that is precisely the
 * invariante from docs/06 (a locally finished step never unlocks the next).
 */
export function countsAsPredecessorSatisfied(status: WorkStepStatus): boolean {
  return status === 'COMPLETED' || status === 'SKIPPED';
}

/** Evidence (checklist answers, photos, measurements) may only be recorded
 *  while the step is actually being worked on. */
export function acceptsEvidence(status: WorkStepStatus): boolean {
  return status === 'IN_PROGRESS';
}
