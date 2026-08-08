import { isValidProjectTransition, type ProjectStatus } from '../project-status';

const ALL_STATUSES: ProjectStatus[] = [
  'DRAFT',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
];

const VALID: Array<[ProjectStatus, ProjectStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'ON_HOLD'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
  ['ON_HOLD', 'ACTIVE'],
  ['ON_HOLD', 'CANCELLED'],
  ['COMPLETED', 'ARCHIVED'],
  ['CANCELLED', 'ARCHIVED'],
];

describe('project status machine', () => {
  it.each(VALID)('%s → %s is valid', (from, to) => {
    expect(isValidProjectTransition(from, to)).toBe(true);
  });

  it('ARCHIVED is terminal — no transitions out', () => {
    for (const to of ALL_STATUSES) {
      expect(isValidProjectTransition('ARCHIVED', to)).toBe(false);
    }
  });

  it('rejects skipping straight from DRAFT to COMPLETED', () => {
    expect(isValidProjectTransition('DRAFT', 'COMPLETED')).toBe(false);
  });

  it('rejects skipping straight from DRAFT to ARCHIVED', () => {
    expect(isValidProjectTransition('DRAFT', 'ARCHIVED')).toBe(false);
  });

  it('rejects resurrecting a COMPLETED project back to ACTIVE', () => {
    expect(isValidProjectTransition('COMPLETED', 'ACTIVE')).toBe(false);
  });

  it('every declared valid transition pair is exhaustively listed above (no undocumented valid pairs)', () => {
    const validSet = new Set(VALID.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const declared = validSet.has(`${from}->${to}`);
        expect(isValidProjectTransition(from, to)).toBe(declared);
      }
    }
  });
});
