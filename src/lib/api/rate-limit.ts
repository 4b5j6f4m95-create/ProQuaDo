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
 * The default store is per **process** and in memory. On a single instance
 * that is a real limit. Behind several instances it is a limit per instance,
 * so N replicas allow N× the configured rate — that is a genuine weakening,
 * not a rounding error, and the fix is a shared store (Redis) at the point
 * where the deployment actually becomes multi-instance. Since ADR-007 keeps
 * Redis out of the MVP, `RateLimitStore` exists so that swapping it in later
 * is one implementation, not a rewrite.
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
  /** Records one hit and reports whether it was within the limit. */
  hit(key: string, rule: RateLimitRule, now: number): RateLimitDecision;
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

  hit(key: string, rule: RateLimitRule, now: number): RateLimitDecision {
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

let store: RateLimitStore = new InMemoryRateLimitStore();

/** Swap in a shared store when the deployment becomes multi-instance — see
 *  the scope note at the top of this file. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export function getRateLimitStore(): RateLimitStore {
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
export function assertWithinRateLimit(
  category: RateLimitCategory,
  subject: RateLimitSubject,
  now: number = Date.now(),
): RateLimitDecision {
  const rule = RATE_LIMITS[category];
  const scope =
    rule.subject === 'device' ? (subject.deviceId ?? `user:${subject.userId}`) : subject.userId;
  const decision = store.hit(`${category}:${scope}`, rule, now);

  if (!decision.allowed) {
    throw new RateLimitExceededError(category, decision.retryAfterSeconds);
  }
  return decision;
}
