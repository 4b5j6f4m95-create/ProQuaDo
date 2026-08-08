import { isOrderExecutable, isValidProductionOrderTransition } from '../production-order-status';

describe('isValidProductionOrderTransition', () => {
  it('follows the documented lifecycle', () => {
    expect(isValidProductionOrderTransition('DRAFT', 'PLANNED')).toBe(true);
    expect(isValidProductionOrderTransition('PLANNED', 'RELEASED')).toBe(true);
    expect(isValidProductionOrderTransition('RELEASED', 'IN_PROGRESS')).toBe(true);
    expect(isValidProductionOrderTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('rejects shortcuts around release', () => {
    expect(isValidProductionOrderTransition('DRAFT', 'RELEASED')).toBe(false);
    expect(isValidProductionOrderTransition('DRAFT', 'IN_PROGRESS')).toBe(false);
    expect(isValidProductionOrderTransition('PLANNED', 'COMPLETED')).toBe(false);
  });

  it('allows blocking and unblocking', () => {
    expect(isValidProductionOrderTransition('IN_PROGRESS', 'ON_HOLD')).toBe(true);
    expect(isValidProductionOrderTransition('ON_HOLD', 'IN_PROGRESS')).toBe(true);
    expect(isValidProductionOrderTransition('IN_PROGRESS', 'QUALITY_BLOCKED')).toBe(true);
    expect(isValidProductionOrderTransition('QUALITY_BLOCKED', 'IN_PROGRESS')).toBe(true);
  });

  it('treats a completed order as final except for archiving', () => {
    expect(isValidProductionOrderTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isValidProductionOrderTransition('COMPLETED', 'ARCHIVED')).toBe(true);
    expect(isValidProductionOrderTransition('ARCHIVED', 'IN_PROGRESS')).toBe(false);
  });
});

describe('isOrderExecutable', () => {
  it('permits work only while the order is released or running', () => {
    expect(isOrderExecutable('RELEASED')).toBe(true);
    expect(isOrderExecutable('IN_PROGRESS')).toBe(true);
  });

  it('freezes all steps of a blocked, paused or finished order', () => {
    expect(isOrderExecutable('ON_HOLD')).toBe(false);
    expect(isOrderExecutable('QUALITY_BLOCKED')).toBe(false);
    expect(isOrderExecutable('PAUSED')).toBe(false);
    expect(isOrderExecutable('DRAFT')).toBe(false);
    expect(isOrderExecutable('COMPLETED')).toBe(false);
  });
});
