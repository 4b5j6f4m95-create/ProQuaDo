// Matches docs/03_STATE_MACHINES.md §1 "Production Order Status Machine".
export type ProductionOrderStatus =
  | 'DRAFT'
  | 'PLANNED'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'ON_HOLD'
  | 'QUALITY_BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ARCHIVED';

const VALID_TRANSITIONS: Record<ProductionOrderStatus, readonly ProductionOrderStatus[]> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'PAUSED', 'ON_HOLD', 'QUALITY_BLOCKED', 'CANCELLED'],
  PAUSED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'RELEASED', 'CANCELLED'],
  QUALITY_BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function isValidProductionOrderTransition(
  from: ProductionOrderStatus,
  to: ProductionOrderStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Whether work steps of this order may be started/executed at all. Every
 * execution service asks this BEFORE looking at the step's own status: an
 * order that is ON_HOLD or QUALITY_BLOCKED freezes all of its steps
 * regardless of how far along they are (docs/03 "Blockierende NCR sperrt
 * den Nachfolgeschritt", error code ORDER_ON_HOLD).
 */
export function isOrderExecutable(status: ProductionOrderStatus): boolean {
  return status === 'RELEASED' || status === 'IN_PROGRESS';
}
