import { backoffSecondsForAttempt } from '../webhook-delivery';

/**
 * The retry schedule is the promise this integration makes to a receiver
 * that is briefly down. Asserted rather than described, for the same reason
 * as the PIN lockout curve: the numbers are the argument.
 */
describe('backoffSecondsForAttempt', () => {
  it('grows fast and then stops', () => {
    expect(backoffSecondsForAttempt(1)).toBe(60);
    expect(backoffSecondsForAttempt(2)).toBe(300);
    expect(backoffSecondsForAttempt(3)).toBe(1500);
    expect(backoffSecondsForAttempt(4)).toBe(3600);
    expect(backoffSecondsForAttempt(5)).toBe(3600);
  });

  it('spans a working day across the six attempts, not a week', () => {
    // Long enough to ride out a receiver's maintenance window; short enough
    // that somebody notices the failure the same day.
    const total = [1, 2, 3, 4, 5].reduce((sum, n) => sum + backoffSecondsForAttempt(n), 0);
    expect(total / 3600).toBeGreaterThan(2);
    expect(total / 3600).toBeLessThan(4);
  });
});
