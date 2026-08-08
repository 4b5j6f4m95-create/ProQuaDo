import {
  CLIENT_STATUS_LABEL,
  LocalRequirementsNotMetError,
  applyServerEvent,
  canStartLocally,
  findLocalGaps,
  markSubmitted,
  prepareLocalCompletion,
  startLocally,
  type ClientWorkStepStatus,
  type LocalWorkStep,
} from '../client-work-step-status';

const COMPLETE: Parameters<typeof prepareLocalCompletion>[1] = {
  requiredChecklistItemIds: ['c1'],
  answeredChecklistItemIds: ['c1'],
  requiredPhotoCounts: [{ requirementId: 'p1', minCount: 1 }],
  capturedPhotoCountsByRequirement: { p1: 1 },
  requiredCharacteristicIds: ['m1'],
  measuredCharacteristicIds: ['m1'],
  hasConfirmation: true,
};

function step(overrides: Partial<LocalWorkStep> = {}): LocalWorkStep {
  return {
    workStepInstanceId: 'step-5',
    productionOrderId: 'order-1',
    stepNumber: 5,
    title: 'Gehäuse fräsen',
    status: 'IN_PROGRESS',
    entityVersion: 3,
    releaseToken: 'signed.token',
    ...overrides,
  };
}

// This is the structural half of the central invariant (docs/06 "Client
// State Machine (Typsicherheit)"): the client's vocabulary simply does not
// contain COMPLETED, so no client code path can produce it.
describe('the client type has no COMPLETED', () => {
  it('does not list COMPLETED among the client statuses', () => {
    const statuses = Object.keys(CLIENT_STATUS_LABEL) as ClientWorkStepStatus[];
    expect(statuses).not.toContain('COMPLETED');
    // The server-confirmed projection exists, and is spelled differently on
    // purpose — it can only be produced by applyServerEvent.
    expect(statuses).toContain('SERVER_CONFIRMED_COMPLETED');
  });

  it('reaches the local end state and no further', () => {
    const completed = prepareLocalCompletion(step(), COMPLETE, () => '2026-08-08T10:00:00.000Z');
    expect(completed.status).toBe('COMPLETED_PENDING_SYNC');
    expect(completed.localCompletedAt).toBe('2026-08-08T10:00:00.000Z');

    // Submitting moves it to WAITING_FOR_SERVER — still not complete.
    expect(markSubmitted(completed).status).toBe('WAITING_FOR_SERVER');
  });
});

describe('prepareLocalCompletion', () => {
  it('refuses when required evidence is missing locally', () => {
    expect(() =>
      prepareLocalCompletion(step(), { ...COMPLETE, answeredChecklistItemIds: [] }),
    ).toThrow(LocalRequirementsNotMetError);
  });

  it('refuses for a step that is not being worked on', () => {
    expect(() => prepareLocalCompletion(step({ status: 'READY' }), COMPLETE)).toThrow(
      /Nur ein laufender Arbeitsschritt/,
    );
  });

  it('does not judge tolerances — only presence', () => {
    // A value that is wildly out of tolerance is still "erfasst" locally.
    // The verdict belongs to the server (docs/06 "nicht Toleranzprüfung -
    // das macht Server!"), and a client that pre-judged it would teach
    // workers to trust an answer the server may contradict.
    const gaps = findLocalGaps({ ...COMPLETE, measuredCharacteristicIds: ['m1'] });
    expect(gaps).toEqual([]);
  });
});

describe('startLocally', () => {
  it('starts a released step that carries its token', () => {
    expect(startLocally(step({ status: 'READY' })).status).toBe('IN_PROGRESS');
  });

  // Negativtest #1, seen from the device: the successor of a locally
  // finished step is LOCKED and has no token, so there is no local path
  // that starts it.
  it('refuses a LOCKED step outright', () => {
    expect(() => startLocally(step({ status: 'LOCKED', releaseToken: undefined }))).toThrow(
      /nicht freigegeben/,
    );
  });

  it('refuses a READY step whose release proof is not on this device', () => {
    expect(() => startLocally(step({ status: 'READY', releaseToken: undefined }))).toThrow(
      /keine Serverfreigabe/,
    );
  });

  it('offers no start button without a token', () => {
    expect(canStartLocally(step({ status: 'READY' }))).toBe(true);
    expect(canStartLocally(step({ status: 'READY', releaseToken: undefined }))).toBe(false);
    expect(canStartLocally(step({ status: 'LOCKED' }))).toBe(false);
    expect(canStartLocally(step({ status: 'COMPLETED_PENDING_SYNC' }))).toBe(false);
  });
});

describe('applyServerEvent', () => {
  const local = step({ status: 'WAITING_FOR_SERVER' });

  it('is the only way to reach SERVER_CONFIRMED_COMPLETED', () => {
    const next = applyServerEvent(
      {
        eventType: 'work_step.completed',
        aggregateId: 'step-5',
        payload: {},
        serverTimestamp: '2026-08-08T11:00:00.000Z',
      },
      local,
    );
    expect(next.status).toBe('SERVER_CONFIRMED_COMPLETED');
    expect(next.serverConfirmedAt).toBe('2026-08-08T11:00:00.000Z');
  });

  it('unlocks a successor only on work_step.released', () => {
    const successor = step({
      workStepInstanceId: 'step-6',
      status: 'LOCKED',
      releaseToken: undefined,
    });
    const unchanged = applyServerEvent(
      {
        eventType: 'work_step.completed',
        aggregateId: 'step-5',
        payload: {},
        serverTimestamp: 'x',
      },
      successor,
    );
    expect(unchanged.status).toBe('LOCKED');

    const released = applyServerEvent(
      {
        eventType: 'work_step.released',
        aggregateId: 'step-6',
        payload: {},
        serverTimestamp: 'x',
      },
      successor,
    );
    expect(released.status).toBe('READY');
    // READY but not yet startable: the token is fetched separately.
    expect(canStartLocally(released)).toBe(false);
  });

  it('ignores events for other steps', () => {
    const next = applyServerEvent(
      { eventType: 'work_step.completed', aggregateId: 'other', payload: {}, serverTimestamp: 'x' },
      local,
    );
    expect(next).toBe(local);
  });

  it('projects a rejection with its reasons', () => {
    const next = applyServerEvent(
      {
        eventType: 'work_step.completion_rejected',
        aggregateId: 'step-5',
        payload: { reasons: [{ code: 'PHOTO_MISSING', detail: 'Foto fehlt.' }] },
        serverTimestamp: 'x',
      },
      local,
    );
    expect(next.status).toBe('SERVER_CONFIRMED_REJECTED');
    expect(next.rejectionReasons).toEqual([{ code: 'PHOTO_MISSING', detail: 'Foto fehlt.' }]);
  });

  it('carries the conflict id through a block so the tablet can link to it', () => {
    const next = applyServerEvent(
      {
        eventType: 'work_step.blocked',
        aggregateId: 'step-5',
        payload: { conflictId: 'conflict-1', cause: 'REVISION_CONFLICT' },
        serverTimestamp: 'x',
      },
      local,
    );
    expect(next.status).toBe('BLOCKED_BY_SERVER');
    expect(next.conflictId).toBe('conflict-1');
  });
});
