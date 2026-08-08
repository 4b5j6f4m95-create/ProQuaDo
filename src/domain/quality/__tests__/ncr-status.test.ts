import {
  classifyBlocking,
  isNonConformanceOpen,
  isValidNonConformanceTransition,
} from '../ncr-status';

describe('isValidNonConformanceTransition', () => {
  it('follows the documented path from report to closure', () => {
    expect(isValidNonConformanceTransition('OPEN', 'ASSESSMENT_REQUIRED')).toBe(true);
    expect(isValidNonConformanceTransition('ASSESSMENT_REQUIRED', 'CONTAINMENT')).toBe(true);
    expect(isValidNonConformanceTransition('CONTAINMENT', 'REWORK')).toBe(true);
    expect(isValidNonConformanceTransition('REWORK', 'REINSPECTION')).toBe(true);
    expect(isValidNonConformanceTransition('REINSPECTION', 'AWAITING_DISPOSITION')).toBe(true);
    expect(isValidNonConformanceTransition('AWAITING_DISPOSITION', 'CLOSED')).toBe(true);
  });

  it('allows skipping rework when containment already settles it', () => {
    expect(isValidNonConformanceTransition('CONTAINMENT', 'AWAITING_DISPOSITION')).toBe(true);
    expect(isValidNonConformanceTransition('ASSESSMENT_REQUIRED', 'AWAITING_DISPOSITION')).toBe(
      true,
    );
  });

  it('sends a disposition of "rework required" back into rework', () => {
    expect(isValidNonConformanceTransition('AWAITING_DISPOSITION', 'REWORK')).toBe(true);
  });

  it('never closes an NCR without a disposition', () => {
    expect(isValidNonConformanceTransition('OPEN', 'CLOSED')).toBe(false);
    expect(isValidNonConformanceTransition('CONTAINMENT', 'CLOSED')).toBe(false);
    expect(isValidNonConformanceTransition('REWORK', 'CLOSED')).toBe(false);
  });

  it('treats CLOSED and CANCELLED as terminal', () => {
    expect(isValidNonConformanceTransition('CLOSED', 'OPEN')).toBe(false);
    expect(isValidNonConformanceTransition('CANCELLED', 'OPEN')).toBe(false);
  });
});

describe('isNonConformanceOpen', () => {
  it('counts every non-final status as open', () => {
    expect(isNonConformanceOpen('OPEN')).toBe(true);
    expect(isNonConformanceOpen('REWORK')).toBe(true);
    expect(isNonConformanceOpen('AWAITING_DISPOSITION')).toBe(true);
    expect(isNonConformanceOpen('CLOSED')).toBe(false);
    expect(isNonConformanceOpen('CANCELLED')).toBe(false);
  });
});

describe('classifyBlocking', () => {
  it('blocks on critical and high priority', () => {
    expect(classifyBlocking({ priority: 'CRITICAL' })).toBe(true);
    expect(classifyBlocking({ priority: 'HIGH' })).toBe(true);
  });

  it('blocks on the always-blocking categories regardless of priority', () => {
    expect(classifyBlocking({ priority: 'LOW', errorCategory: 'MATERIALFEHLER' })).toBe(true);
    expect(
      classifyBlocking({ priority: 'LOW', errorCategory: 'MEASUREMENT_OUT_OF_TOLERANCE' }),
    ).toBe(true);
  });

  it('lets a reporter escalate but never de-escalate', () => {
    expect(classifyBlocking({ priority: 'LOW', reporterSuggestsBlocking: true })).toBe(true);
    // There is no input that makes a CRITICAL finding non-blocking — only a
    // QM assessment can lower the classification, and that is a different
    // code path with a mandatory reason.
    expect(classifyBlocking({ priority: 'CRITICAL', reporterSuggestsBlocking: false })).toBe(true);
  });

  it('leaves a low-priority cosmetic finding non-blocking', () => {
    expect(classifyBlocking({ priority: 'LOW', errorCategory: 'OBERFLAECHE' })).toBe(false);
    expect(classifyBlocking({ priority: 'MEDIUM' })).toBe(false);
  });
});
