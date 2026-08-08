import {
  isValidPlanRevisionTransition,
  isPlanStructureEditable,
  type PlanRevisionStatus,
} from '../plan-revision-status';

const ALL_STATUSES: PlanRevisionStatus[] = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'RELEASED',
  'SUPERSEDED',
  'ARCHIVED',
];

const VALID: Array<[PlanRevisionStatus, PlanRevisionStatus]> = [
  ['DRAFT', 'IN_REVIEW'],
  ['IN_REVIEW', 'APPROVED'],
  ['IN_REVIEW', 'DRAFT'],
  ['APPROVED', 'RELEASED'],
  ['RELEASED', 'SUPERSEDED'],
  ['SUPERSEDED', 'ARCHIVED'],
];

describe('production plan revision status machine', () => {
  it.each(VALID)('%s → %s is valid', (from, to) => {
    expect(isValidPlanRevisionTransition(from, to)).toBe(true);
  });

  it('exhaustively matches the declared valid set', () => {
    const validSet = new Set(VALID.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(isValidPlanRevisionTransition(from, to)).toBe(validSet.has(`${from}->${to}`));
      }
    }
  });

  it('cannot skip APPROVED (DRAFT/IN_REVIEW straight to RELEASED)', () => {
    expect(isValidPlanRevisionTransition('DRAFT', 'RELEASED')).toBe(false);
    expect(isValidPlanRevisionTransition('IN_REVIEW', 'RELEASED')).toBe(false);
  });
});

describe('isPlanStructureEditable', () => {
  it('only DRAFT allows structural edits', () => {
    expect(isPlanStructureEditable('DRAFT')).toBe(true);
    for (const status of ALL_STATUSES) {
      if (status === 'DRAFT') continue;
      expect(isPlanStructureEditable(status)).toBe(false);
    }
  });
});
