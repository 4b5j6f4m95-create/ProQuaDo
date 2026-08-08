// Project status machine. Not specified as a dedicated diagram in
// docs/03_STATE_MACHINES.md (which covers Order/WorkStep/Document/Plan/NCR/
// Sync) — this follows the same explicit-guard-table convention rather than
// scattered boolean checks, per MASTERPROMPT.md Kap. 21 (Coding- und
// Architekturstandards): "Status als explizite State Machine, nicht als
// verstreute Boolean-Kombinationen."
export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';

const VALID_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function isValidProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
