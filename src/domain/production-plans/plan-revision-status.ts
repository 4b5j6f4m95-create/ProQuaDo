// Matches docs/03_STATE_MACHINES.md "Production Plan Revision Status Machine".
export type PlanRevisionStatus =
  'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'RELEASED' | 'SUPERSEDED' | 'ARCHIVED';

const VALID_TRANSITIONS: Record<PlanRevisionStatus, readonly PlanRevisionStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['RELEASED'],
  RELEASED: ['SUPERSEDED'],
  SUPERSEDED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function isValidPlanRevisionTransition(
  from: PlanRevisionStatus,
  to: PlanRevisionStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** Plan structure (steps/dependencies) may only be edited while the graph
 * isn't frozen for review — matches "Nach Planfreigabe erzeugt jede
 * Änderung eine neue Revision" (docs/07 Änderungsmanagement). */
export function isPlanStructureEditable(status: PlanRevisionStatus): boolean {
  return status === 'DRAFT';
}
