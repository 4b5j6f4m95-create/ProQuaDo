import {
  PIN_ATTEMPTS_BEFORE_LOCK,
  PIN_MAX_LOCK_SECONDS,
  lockSecondsForAttempts,
} from '../confirm-with-pin';

/**
 * The backoff curve IS the security argument of ADR-005's amendment, so it is
 * asserted rather than described. A four-digit PIN is 10 000 combinations;
 * what makes guessing hopeless is how quickly the wait grows and where it
 * settles, not that a lock exists at all.
 */
describe('lockSecondsForAttempts', () => {
  it('costs nothing until the threshold', () => {
    for (let attempts = 0; attempts < PIN_ATTEMPTS_BEFORE_LOCK; attempts++) {
      expect(lockSecondsForAttempts(attempts)).toBe(0);
    }
  });

  it('starts at a minute and doubles', () => {
    expect(lockSecondsForAttempts(PIN_ATTEMPTS_BEFORE_LOCK)).toBe(60);
    expect(lockSecondsForAttempts(PIN_ATTEMPTS_BEFORE_LOCK + 1)).toBe(120);
    expect(lockSecondsForAttempts(PIN_ATTEMPTS_BEFORE_LOCK + 2)).toBe(240);
    expect(lockSecondsForAttempts(PIN_ATTEMPTS_BEFORE_LOCK + 3)).toBe(480);
  });

  it('settles at the cap instead of growing without bound', () => {
    // A lock that keeps doubling ends up locking a worker out for days over
    // a mistyped PIN, which is a worse failure than the one it prevents.
    expect(lockSecondsForAttempts(PIN_ATTEMPTS_BEFORE_LOCK + 4)).toBe(PIN_MAX_LOCK_SECONDS);
    expect(lockSecondsForAttempts(50)).toBe(PIN_MAX_LOCK_SECONDS);
    expect(lockSecondsForAttempts(10_000)).toBe(PIN_MAX_LOCK_SECONDS);
  });

  it('keeps exhaustive guessing out of reach', () => {
    // The number that matters, stated rather than assumed: at the capped
    // rate, sweeping all 10 000 combinations of a four-digit PIN takes about
    // three weeks of uninterrupted guessing — half that on average — and
    // every single attempt writes an audit event.
    //
    // Asserted as a floor of two weeks so the test fails if somebody raises
    // PIN_ATTEMPTS_BEFORE_LOCK or lowers the cap far enough to matter,
    // without breaking on a small adjustment.
    const rounds = 10_000 / PIN_ATTEMPTS_BEFORE_LOCK;
    const days = (rounds * PIN_MAX_LOCK_SECONDS) / 86_400;

    expect(days).toBeGreaterThan(14);
    expect(days).toBeCloseTo(20.8, 1);
  });
});
