import {
  acceptsEvidence,
  countsAsPredecessorSatisfied,
  isValidWorkStepTransition,
  type WorkStepStatus,
} from '../work-step-status';

describe('isValidWorkStepTransition', () => {
  it('allows the documented online happy path', () => {
    expect(isValidWorkStepTransition('LOCKED', 'READY')).toBe(true);
    expect(isValidWorkStepTransition('READY', 'IN_PROGRESS')).toBe(true);
    expect(isValidWorkStepTransition('IN_PROGRESS', 'VALIDATING')).toBe(true);
    expect(isValidWorkStepTransition('VALIDATING', 'COMPLETED')).toBe(true);
  });

  it('allows the offline path reserved for Phase 5', () => {
    expect(isValidWorkStepTransition('IN_PROGRESS', 'COMPLETED_PENDING_SYNC')).toBe(true);
    expect(isValidWorkStepTransition('COMPLETED_PENDING_SYNC', 'WAITING_FOR_SERVER')).toBe(true);
    expect(isValidWorkStepTransition('WAITING_FOR_SERVER', 'VALIDATING')).toBe(true);
  });

  // The central invariant, expressed as a type-level fact: there is no
  // transition from any client-reachable state directly to COMPLETED.
  // COMPLETED is reachable only from states that ONLY the server can enter —
  // VALIDATING, AWAITING_SECOND_APPROVAL, and since Phase 5 BLOCKED, which
  // a recorded conflict decision can resolve as "Weiterhin gültig"
  // (src/domain/sync/decide-conflict.ts). No device can produce any of the
  // three (docs/06, Negativtest #2).
  it('never allows COMPLETED except from a server-owned state', () => {
    const allStatuses: WorkStepStatus[] = [
      'LOCKED',
      'READY',
      'IN_PROGRESS',
      'PAUSED',
      'COMPLETED_PENDING_SYNC',
      'WAITING_FOR_SERVER',
      'VALIDATING',
      'AWAITING_SECOND_APPROVAL',
      'COMPLETED',
      'COMPLETION_REJECTED',
      'BLOCKED',
      'SKIP_REQUESTED',
      'SKIPPED',
      'REWORK_REQUIRED',
      'SUPERSEDED',
    ];

    const canReachCompleted = allStatuses.filter((from) =>
      isValidWorkStepTransition(from, 'COMPLETED'),
    );
    expect(canReachCompleted.sort()).toEqual(['AWAITING_SECOND_APPROVAL', 'BLOCKED', 'VALIDATING']);
  });

  it('rejects skipping validation', () => {
    expect(isValidWorkStepTransition('LOCKED', 'IN_PROGRESS')).toBe(false);
    expect(isValidWorkStepTransition('READY', 'COMPLETED')).toBe(false);
    expect(isValidWorkStepTransition('IN_PROGRESS', 'COMPLETED')).toBe(false);
  });

  it('treats COMPLETED, SKIPPED and SUPERSEDED as terminal', () => {
    expect(isValidWorkStepTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isValidWorkStepTransition('SKIPPED', 'IN_PROGRESS')).toBe(false);
    expect(isValidWorkStepTransition('SUPERSEDED', 'READY')).toBe(false);
  });

  it('lets a rejected completion be reworked', () => {
    expect(isValidWorkStepTransition('COMPLETION_REJECTED', 'IN_PROGRESS')).toBe(true);
    expect(isValidWorkStepTransition('COMPLETION_REJECTED', 'COMPLETED')).toBe(false);
  });
});

describe('countsAsPredecessorSatisfied', () => {
  it('counts only server-confirmed outcomes', () => {
    expect(countsAsPredecessorSatisfied('COMPLETED')).toBe(true);
    expect(countsAsPredecessorSatisfied('SKIPPED')).toBe(true);
  });

  // Negativtest #1: a locally completed step must never unlock its
  // successor — this is the predicate that decides that.
  it('does NOT count a locally completed or pending step', () => {
    expect(countsAsPredecessorSatisfied('COMPLETED_PENDING_SYNC')).toBe(false);
    expect(countsAsPredecessorSatisfied('WAITING_FOR_SERVER')).toBe(false);
    expect(countsAsPredecessorSatisfied('VALIDATING')).toBe(false);
    expect(countsAsPredecessorSatisfied('AWAITING_SECOND_APPROVAL')).toBe(false);
  });
});

describe('acceptsEvidence', () => {
  it('accepts evidence only while the step is in progress', () => {
    expect(acceptsEvidence('IN_PROGRESS')).toBe(true);
    expect(acceptsEvidence('READY')).toBe(false);
    expect(acceptsEvidence('PAUSED')).toBe(false);
    expect(acceptsEvidence('COMPLETED')).toBe(false);
  });
});
