import {
  InMemoryRateLimitStore,
  PostgresRateLimitStore,
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

  it('allows exactly the documented number and refuses the next', async () => {
    for (let i = 0; i < RATE_LIMITS.EXPORT.limit; i++) {
      expect((await assertWithinRateLimit('EXPORT', subject, 1_000)).allowed).toBe(true);
    }
    await expect(assertWithinRateLimit('EXPORT', subject, 1_000)).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
  });

  it('reports a retry-after a client can actually wait for', async () => {
    for (let i = 0; i < RATE_LIMITS.EXPORT.limit; i++) {
      await assertWithinRateLimit('EXPORT', subject, 1_000);
    }
    try {
      await assertWithinRateLimit('EXPORT', subject, 1_000);
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

  it('lets the window expire', async () => {
    for (let i = 0; i < RATE_LIMITS.DOCUMENT_UPLOAD.limit; i++) {
      await assertWithinRateLimit('DOCUMENT_UPLOAD', subject, 1_000);
    }
    await expect(assertWithinRateLimit('DOCUMENT_UPLOAD', subject, 1_000)).rejects.toThrow();

    const afterWindow = 1_000 + RATE_LIMITS.DOCUMENT_UPLOAD.windowMs + 1;
    expect((await assertWithinRateLimit('DOCUMENT_UPLOAD', subject, afterWindow)).allowed).toBe(
      true,
    );
  });

  it('counts each user and each category separately', async () => {
    for (let i = 0; i < RATE_LIMITS.EXPORT.limit; i++) {
      await assertWithinRateLimit('EXPORT', { userId: 'user-a' }, 1_000);
    }
    // A second user is unaffected…
    expect((await assertWithinRateLimit('EXPORT', { userId: 'user-b' }, 1_000)).allowed).toBe(true);
    // …and so is a different category for the same user.
    expect(
      (await assertWithinRateLimit('DOCUMENT_UPLOAD', { userId: 'user-a' }, 1_000)).allowed,
    ).toBe(true);
  });

  it('counts device-scoped limits per device', async () => {
    for (let i = 0; i < RATE_LIMITS.SYNC_COMMANDS.limit; i++) {
      await assertWithinRateLimit('SYNC_COMMANDS', { userId: 'u', deviceId: 'tablet-1' }, 1_000);
    }
    await expect(
      assertWithinRateLimit('SYNC_COMMANDS', { userId: 'u', deviceId: 'tablet-1' }, 1_000),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    expect(
      (await assertWithinRateLimit('SYNC_COMMANDS', { userId: 'u', deviceId: 'tablet-2' }, 1_000))
        .allowed,
    ).toBe(true);
  });

  // A device-scoped rule must not become unlimited just because the client
  // omitted the field it controls.
  it('falls back to the user when a device-scoped call sends no device id', async () => {
    for (let i = 0; i < RATE_LIMITS.SYNC_COMMANDS.limit; i++) {
      await assertWithinRateLimit('SYNC_COMMANDS', { userId: 'anonym' }, 1_000);
    }
    await expect(
      assertWithinRateLimit('SYNC_COMMANDS', { userId: 'anonym' }, 1_000),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('can be pointed at a different store', () => {
    const replacement = new InMemoryRateLimitStore();
    setRateLimitStore(replacement);
    expect(getRateLimitStore()).toBe(replacement);
  });
});

describe('store selection', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    setRateLimitStore(store);
  });

  function selected(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    setRateLimitStore(undefined);
    return getRateLimitStore();
  }

  // The default falls on this side because the failure modes are not
  // symmetric: a shared store in development costs a query nobody notices,
  // while process-local counters in a scaled production silently multiply
  // every limit in the docs/05 contract by the number of replicas.
  it('counts in the shared table by default in production', () => {
    expect(selected({ NODE_ENV: 'production', RATE_LIMIT_STORE: undefined })).toBeInstanceOf(
      PostgresRateLimitStore,
    );
  });

  it('counts in memory by default everywhere else', () => {
    expect(selected({ NODE_ENV: 'development', RATE_LIMIT_STORE: undefined })).toBeInstanceOf(
      InMemoryRateLimitStore,
    );
    expect(selected({ NODE_ENV: 'test', RATE_LIMIT_STORE: undefined })).toBeInstanceOf(
      InMemoryRateLimitStore,
    );
  });

  it('lets the environment override in either direction', () => {
    expect(selected({ NODE_ENV: 'development', RATE_LIMIT_STORE: 'postgres' })).toBeInstanceOf(
      PostgresRateLimitStore,
    );
    // Explicitly opting out in production is allowed — a single-instance
    // deployment that wants to skip the query is a legitimate choice, and one
    // somebody has to make on purpose.
    expect(selected({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'memory' })).toBeInstanceOf(
      InMemoryRateLimitStore,
    );
  });
});
