import {
  InMemoryRateLimitStore,
  RATE_LIMITS,
  RateLimitExceededError,
  assertWithinRateLimit,
  getRateLimitStore,
  setRateLimitStore,
} from '../rate-limit';

const store = new InMemoryRateLimitStore();

beforeEach(() => {
  store.reset();
  setRateLimitStore(store);
});

describe('RATE_LIMITS', () => {
  // The table is the API contract (docs/05). If these numbers drift from the
  // document, clients that budget their requests against the published
  // figures start getting 429s they had no way to anticipate.
  it('matches the published contract', () => {
    expect(RATE_LIMITS.STANDARD_API).toEqual({ limit: 100, windowMs: 60_000, subject: 'user' });
    expect(RATE_LIMITS.SYNC_COMMANDS).toEqual({ limit: 10, windowMs: 60_000, subject: 'device' });
    expect(RATE_LIMITS.PHOTO_UPLOAD).toEqual({ limit: 20, windowMs: 60_000, subject: 'device' });
    expect(RATE_LIMITS.DOCUMENT_UPLOAD).toEqual({ limit: 5, windowMs: 60_000, subject: 'user' });
    expect(RATE_LIMITS.EXPORT).toEqual({ limit: 5, windowMs: 3_600_000, subject: 'user' });
  });
});

describe('assertWithinRateLimit', () => {
  const subject = { userId: 'user-1' };

  it('allows exactly the documented number and refuses the next', () => {
    for (let i = 0; i < RATE_LIMITS.EXPORT.limit; i++) {
      expect(assertWithinRateLimit('EXPORT', subject, 1_000).allowed).toBe(true);
    }
    expect(() => assertWithinRateLimit('EXPORT', subject, 1_000)).toThrow(RateLimitExceededError);
  });

  it('reports a retry-after a client can actually wait for', () => {
    for (let i = 0; i < RATE_LIMITS.EXPORT.limit; i++) {
      assertWithinRateLimit('EXPORT', subject, 1_000);
    }
    try {
      assertWithinRateLimit('EXPORT', subject, 1_000);
      throw new Error('sollte werfen');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitExceededError);
      const limitError = error as RateLimitExceededError;
      expect(limitError.status).toBe(429);
      expect(limitError.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(limitError.retryAfterSeconds).toBeGreaterThan(0);
      expect(limitError.retryAfterSeconds).toBeLessThanOrEqual(3600);
    }
  });

  it('lets the window expire', () => {
    for (let i = 0; i < RATE_LIMITS.DOCUMENT_UPLOAD.limit; i++) {
      assertWithinRateLimit('DOCUMENT_UPLOAD', subject, 1_000);
    }
    expect(() => assertWithinRateLimit('DOCUMENT_UPLOAD', subject, 1_000)).toThrow();

    const afterWindow = 1_000 + RATE_LIMITS.DOCUMENT_UPLOAD.windowMs + 1;
    expect(assertWithinRateLimit('DOCUMENT_UPLOAD', subject, afterWindow).allowed).toBe(true);
  });

  it('counts each user and each category separately', () => {
    for (let i = 0; i < RATE_LIMITS.EXPORT.limit; i++) {
      assertWithinRateLimit('EXPORT', { userId: 'user-a' }, 1_000);
    }
    // A second user is unaffected…
    expect(assertWithinRateLimit('EXPORT', { userId: 'user-b' }, 1_000).allowed).toBe(true);
    // …and so is a different category for the same user.
    expect(assertWithinRateLimit('DOCUMENT_UPLOAD', { userId: 'user-a' }, 1_000).allowed).toBe(
      true,
    );
  });

  it('counts device-scoped limits per device', () => {
    for (let i = 0; i < RATE_LIMITS.SYNC_COMMANDS.limit; i++) {
      assertWithinRateLimit('SYNC_COMMANDS', { userId: 'u', deviceId: 'tablet-1' }, 1_000);
    }
    expect(() =>
      assertWithinRateLimit('SYNC_COMMANDS', { userId: 'u', deviceId: 'tablet-1' }, 1_000),
    ).toThrow(RateLimitExceededError);

    expect(
      assertWithinRateLimit('SYNC_COMMANDS', { userId: 'u', deviceId: 'tablet-2' }, 1_000).allowed,
    ).toBe(true);
  });

  // A device-scoped rule must not become unlimited just because the client
  // omitted the field it controls.
  it('falls back to the user when a device-scoped call sends no device id', () => {
    for (let i = 0; i < RATE_LIMITS.SYNC_COMMANDS.limit; i++) {
      assertWithinRateLimit('SYNC_COMMANDS', { userId: 'anonym' }, 1_000);
    }
    expect(() => assertWithinRateLimit('SYNC_COMMANDS', { userId: 'anonym' }, 1_000)).toThrow(
      RateLimitExceededError,
    );
  });

  it('can be pointed at a different store', () => {
    const replacement = new InMemoryRateLimitStore();
    setRateLimitStore(replacement);
    expect(getRateLimitStore()).toBe(replacement);
  });
});
