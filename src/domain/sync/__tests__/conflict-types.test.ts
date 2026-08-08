import {
  CONFLICT_TYPES,
  DECISIONS_BY_CONFLICT,
  DECISION_CONSEQUENCE,
  DECISION_LABEL,
  DECISION_TYPES,
  SELF_RESOLVING_CONFLICTS,
  isDecisionAllowed,
} from '../conflict-types';

describe('conflict vocabulary', () => {
  // docs/03_STATE_MACHINES.md §6 lists exactly seven conflict types; the MVP
  // plan's Phase 5 requires the conflict centre to cover "alle 7".
  it('covers all seven documented conflict types', () => {
    expect(CONFLICT_TYPES).toHaveLength(7);
    expect([...CONFLICT_TYPES].sort()).toEqual([
      'BLOCKING_NCR',
      'DUPLICATE_COMMAND',
      'ENTITY_VERSION_CONFLICT',
      'MISSING_OR_CORRUPT_EVIDENCE',
      'ORDER_ON_HOLD',
      'PERMISSION_REVOKED',
      'REVISION_CONFLICT',
    ]);
  });

  it('gives every conflict type a decision set', () => {
    for (const type of CONFLICT_TYPES) {
      expect(DECISIONS_BY_CONFLICT[type]).toBeDefined();
    }
  });

  it('leaves exactly the self-resolving type without decisions', () => {
    const withoutDecisions = CONFLICT_TYPES.filter(
      (type) => DECISIONS_BY_CONFLICT[type].length === 0,
    );
    expect(withoutDecisions).toEqual([...SELF_RESOLVING_CONFLICTS]);
  });

  // docs/06 "Berechtigte Person entscheidet (auditiert)" lists five options
  // for the revision conflict; the sixth (discard) is the refusal case.
  it('offers the five documented decisions for a revision conflict', () => {
    for (const decision of [
      'ACCEPT_AS_VALID',
      'ADDITIONAL_INSPECTION_REQUIRED',
      'REWORK_REQUIRED',
      'REPEAT_REQUIRED',
      'PRODUCTION_HOLD',
    ] as const) {
      expect(isDecisionAllowed('REVISION_CONFLICT', decision)).toBe(true);
    }
  });

  // docs/04: offline work synced after a permission was revoked "wird nicht
  // automatisch freigegeben". Nor by proxy — see the comment on
  // PERMISSION_REVOKED in conflict-types.ts.
  it('never lets a revoked-permission completion simply be waved through', () => {
    expect(isDecisionAllowed('PERMISSION_REVOKED', 'ACCEPT_AS_VALID')).toBe(false);
    expect(isDecisionAllowed('PERMISSION_REVOKED', 'ADDITIONAL_INSPECTION_REQUIRED')).toBe(true);
    expect(isDecisionAllowed('PERMISSION_REVOKED', 'DISCARD_SUBMISSION')).toBe(true);
  });

  it('never lets corrupt evidence be accepted as valid', () => {
    expect(isDecisionAllowed('MISSING_OR_CORRUPT_EVIDENCE', 'ACCEPT_AS_VALID')).toBe(false);
    expect(isDecisionAllowed('MISSING_OR_CORRUPT_EVIDENCE', 'REQUEST_REUPLOAD')).toBe(true);
  });

  it('describes every decision and its consequence for the decision screen', () => {
    for (const decision of DECISION_TYPES) {
      expect(DECISION_LABEL[decision]).toBeTruthy();
      expect(DECISION_CONSEQUENCE[decision]).toBeTruthy();
    }
  });

  it('only allows decisions that exist', () => {
    for (const type of CONFLICT_TYPES) {
      for (const decision of DECISIONS_BY_CONFLICT[type]) {
        expect(DECISION_TYPES).toContain(decision);
      }
    }
  });
});
