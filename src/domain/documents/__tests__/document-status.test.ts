import { isValidDocumentRevisionTransition, type DocumentRevisionStatus } from '../document-status';

const ALL_STATUSES: DocumentRevisionStatus[] = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'RELEASED',
  'SUPERSEDED',
  'WITHDRAWN',
  'ARCHIVED',
];

const VALID: Array<[DocumentRevisionStatus, DocumentRevisionStatus]> = [
  ['DRAFT', 'IN_REVIEW'],
  ['IN_REVIEW', 'APPROVED'],
  ['IN_REVIEW', 'DRAFT'],
  ['APPROVED', 'RELEASED'],
  ['RELEASED', 'SUPERSEDED'],
  ['RELEASED', 'WITHDRAWN'],
  ['SUPERSEDED', 'ARCHIVED'],
  ['WITHDRAWN', 'ARCHIVED'],
];

describe('document revision status machine', () => {
  it.each(VALID)('%s → %s is valid', (from, to) => {
    expect(isValidDocumentRevisionTransition(from, to)).toBe(true);
  });

  it('exhaustively matches the declared valid set — no undocumented transitions', () => {
    const validSet = new Set(VALID.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(isValidDocumentRevisionTransition(from, to)).toBe(validSet.has(`${from}->${to}`));
      }
    }
  });

  it('RELEASED can never go directly back to DRAFT, IN_REVIEW, or APPROVED (Geschäftsgrundsatz 5)', () => {
    expect(isValidDocumentRevisionTransition('RELEASED', 'DRAFT')).toBe(false);
    expect(isValidDocumentRevisionTransition('RELEASED', 'IN_REVIEW')).toBe(false);
    expect(isValidDocumentRevisionTransition('RELEASED', 'APPROVED')).toBe(false);
  });

  it('APPROVED cannot be skipped: DRAFT/IN_REVIEW cannot jump straight to RELEASED', () => {
    expect(isValidDocumentRevisionTransition('DRAFT', 'RELEASED')).toBe(false);
    expect(isValidDocumentRevisionTransition('IN_REVIEW', 'RELEASED')).toBe(false);
  });

  it('SUPERSEDED and WITHDRAWN are only reachable from RELEASED', () => {
    for (const from of ALL_STATUSES) {
      if (from === 'RELEASED') continue;
      expect(isValidDocumentRevisionTransition(from, 'SUPERSEDED')).toBe(false);
      expect(isValidDocumentRevisionTransition(from, 'WITHDRAWN')).toBe(false);
    }
  });
});
