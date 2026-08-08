// Matches docs/03_STATE_MACHINES.md "Document Revision Status Machine".
// Once RELEASED, a revision only ever moves to SUPERSEDED (automatically,
// when a newer revision releases) or WITHDRAWN (manually) — never back to
// an editable state. This is the technical backbone of Geschäftsgrundsatz 5
// ("Alte Dokument-, Plan- und Anweisungsrevisionen werden nie überschrieben").
export type DocumentRevisionStatus =
  'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'RELEASED' | 'SUPERSEDED' | 'WITHDRAWN' | 'ARCHIVED';

const VALID_TRANSITIONS: Record<DocumentRevisionStatus, readonly DocumentRevisionStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['RELEASED'],
  RELEASED: ['SUPERSEDED', 'WITHDRAWN'],
  SUPERSEDED: ['ARCHIVED'],
  WITHDRAWN: ['ARCHIVED'],
  ARCHIVED: [],
};

export function isValidDocumentRevisionTransition(
  from: DocumentRevisionStatus,
  to: DocumentRevisionStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
