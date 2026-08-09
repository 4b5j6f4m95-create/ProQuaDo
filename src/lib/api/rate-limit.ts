import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { DomainError } from '@/lib/domain-errors';

/**
 * Rate limiting — docs/05_API_CONTRACTS.md "Rate Limits & Größenlimits".
 *
 * The table has been in the contract since Phase 1 and nothing enforced it
 * until Phase 7. Two of the limits are not comfort features:
 *
 *  - `EXPORT` is the mechanism ADR-007 leans on when it argues that a
 *    synchronous export is safe. Without it, "an export ties up a request
 *    worker" has no upper bound and the argument does not hold.
 *  - `SYNC_COMMANDS` bounds how often a device can make the server re-run
 *    every Phase 3/4 guard for a batch of up to 500 commands.
 *
 * ## Scope, stated plainly
 *
 * Two stores. `memory` counts per **process**: on a single instance a real
 * limit, behind N replicas a limit per instance and therefore N× the
 * configured rate. `postgres` counts in a shared table and holds regardless of
 * how many instances run.
 *
 * Production defaults to `postgres`, everything else to `memory`, and
 * `RATE_LIMIT_STORE` overrides both. The default is that way round because the
 * failure mode of the wrong choice is asymmetric: a shared store in
 * development costs a query nobody notices, while process-local counters in a
 * scaled production silently multiply every limit in the contract.
 *
 * Postgres rather than Redis: ADR-007 keeps Redis out of the MVP, and the
 * database is already here, already the availability floor of the whole
 * application, and already the thing every request touches.
 *
 * It is also not a DoS defence. An unauthenticated flood is a job for the
 * reverse proxy or WAF in front of this application (docs/08); these limits
 * protect the application from authenticated misuse and runaway clients.
 */

export interface RateLimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
  /** What the limit is counted against — appears in the error message so a
   *  person can tell "your device is too fast" from "you are". */
  subject: 'user' | 'device';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Verbatim from the docs/05 table. Changing a number here changes the
 *  documented contract — update both. */
export const RATE_LIMITS = {
  STANDARD_API: { limit: 100, windowMs: MINUTE, subject: 'user' },
  SYNC_COMMANDS: { limit: 10, windowMs: MINUTE, subject: 'device' },
  PHOTO_UPLOAD: { limit: 20, windowMs: MINUTE, subject: 'device' },
  DOCUMENT_UPLOAD: { limit: 5, windowMs: MINUTE, subject: 'user' },
  EXPORT: { limit: 5, windowMs: HOUR, subject: 'user' },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitCategory = keyof typeof RATE_LIMITS;

export class RateLimitExceededError extends DomainError {
  readonly retryAfterSeconds: number;

  constructor(category: RateLimitCategory, retryAfterSeconds: number) {
    const rule = RATE_LIMITS[category];
    super(
      'RATE_LIMIT_EXCEEDED',
      `Zu viele Anfragen (${rule.limit} pro ${Math.round(rule.windowMs / 1000)} s je ${
        rule.subject === 'device' ? 'Gerät' : 'Benutzer'
      }). Bitte in ${retryAfterSeconds} s erneut versuchen.`,
      429,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  /**
   * Records one hit and reports whether it was within the limit.
   *
   * Asynchronous even though the in-memory implementation has nothing to
   * await. This used to be a synchronous signature, and the comment beside it
   * claimed a shared store would be "one implementation, not a rewrite" —
   * which was not true: no store that talks to a network or a database can
   * satisfy a synchronous contract, so the swap the interface existed to
   * enable was the one thing it prevented.
   */
  hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision>;
}

/**
 * Fixed-window counter. Chosen over a sliding window because the failure mode
 * of a fixed window — up to 2× the rate across a window boundary — is
 * harmless for limits whose purpose is bounding sustained load, and the
 * implementation has no per-request allocation to leak.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  /** Swept on write rather than on a timer: a process that receives no
   *  requests does not need to be doing work. */
  private lastSweep = 0;

  async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision> {
    this.sweep(now);

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    if (existing.count > rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: rule.limit - existing.count, retryAfterSeconds };
  }

  reset(): void {
    this.windows.clear();
    this.lastSweep = 0;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < MINUTE) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * Shared fixed-window counter in `rate_limit_windows`.
 *
 * The whole decision is one statement. That is the point: read-then-write
 * would race between instances and let two requests both see "99 so far" and
 * both proceed, which is exactly the failure the shared store exists to
 * prevent. `ON CONFLICT DO UPDATE` makes the increment and the window roll-over
 * a single atomic act, and the RETURNING clause reports the state the caller
 * actually landed on.
 *
 * The key is hashed before it leaves the process — see the schema comment on
 * RateLimitWindow.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  private lastSweep = 0;

  async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision> {
    const hashed = createHash('sha256').update(key).digest('hex');
    const nowDate = new Date(now);
    const resetAt = new Date(now + rule.windowMs);

    const rows = await prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
      INSERT INTO rate_limit_windows (key, count, reset_at)
      VALUES (${hashed}, 1, ${resetAt})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_windows.reset_at <= ${nowDate} THEN 1
          ELSE rate_limit_windows.count + 1
        END,
        reset_at = CASE
          WHEN rate_limit_windows.reset_at <= ${nowDate} THEN EXCLUDED.reset_at
          ELSE rate_limit_windows.reset_at
        END
      RETURNING count, reset_at
    `;

    const row = rows[0];
    // A missing row cannot happen — RETURNING on an upsert always yields one.
    // If it somehow does, allowing the request is the wrong direction for a
    // limit that guards expensive work, so this fails closed.
    if (!row) return { allowed: false, remaining: 0, retryAfterSeconds: 1 };

    void this.sweep(now);

    const retryAfterSeconds = Math.max(1, Math.ceil((row.reset_at.getTime() - now) / 1000));
    if (row.count > rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: rule.limit - row.count, retryAfterSeconds };
  }

  /** Expired windows are dead weight, not state — deleted opportunistically,
   *  at most once a minute per process, and never on the request's critical
   *  path (the caller does not await this). */
  private async sweep(now: number): Promise<void> {
    if (now - this.lastSweep < MINUTE) return;
    this.lastSweep = now;
    try {
      await prisma.$executeRaw`DELETE FROM rate_limit_windows WHERE reset_at <= ${new Date(now)}`;
    } catch (error) {
      logger.warn({ err: error }, 'rate limit sweep failed');
    }
  }
}

let store: RateLimitStore | undefined;

/**
 * Production counts in the shared table, everything else in memory, and
 * `RATE_LIMIT_STORE` overrides either way. See the scope note at the top for
 * why the default falls on that side.
 */
function defaultStore(): RateLimitStore {
  const configured = process.env.RATE_LIMIT_STORE?.trim().toLowerCase();
  if (configured === 'postgres') return new PostgresRateLimitStore();
  if (configured === 'memory') return new InMemoryRateLimitStore();
  return process.env.NODE_ENV === 'production'
    ? new PostgresRateLimitStore()
    : new InMemoryRateLimitStore();
}

/** Pass `undefined` to fall back to the environment default — which is how a
 *  test can assert what that default actually is. */
export function setRateLimitStore(next: RateLimitStore | undefined): void {
  store = next;
}

export function getRateLimitStore(): RateLimitStore {
  store ??= defaultStore();
  return store;
}

export interface RateLimitSubject {
  userId: string;
  deviceId?: string;
}

/**
 * Throws RateLimitExceededError when the caller is over the limit.
 *
 * A device-scoped rule falls back to the user when no device id is present:
 * an unregistered client must not get an unlimited allowance simply by
 * omitting a field it controls.
 */
export async function assertWithinRateLimit(
  category: RateLimitCategory,
  subject: RateLimitSubject,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const rule = RATE_LIMITS[category];
  const scope =
    rule.subject === 'device' ? (subject.deviceId ?? `user:${subject.userId}`) : subject.userId;
  const decision = await getRateLimitStore().hit(`${category}:${scope}`, rule, now);

  if (!decision.allowed) {
    throw new RateLimitExceededError(category, decision.retryAfterSeconds);
  }
  return decision;
}
