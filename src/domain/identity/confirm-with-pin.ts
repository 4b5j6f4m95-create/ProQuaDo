import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { verifyConfirmationPin } from '@/lib/auth/confirmation-pin';
import {
  ConfirmationFailedError,
  ConfirmationLockedError,
  NotFoundError,
} from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

/**
 * The one place a confirmation PIN is checked — ADR-005's step-up
 * re-authentication, with the lockout that ADR names as its most obvious gap.
 *
 * ## Why this is a single function
 *
 * Until Phase 7 there were FOUR copies of `verifyActorPin`, one each in
 * complete-work-step.ts, second-approval.ts, decide-conflict.ts and
 * product-release.ts. Identical, and each one a place a lockout could be
 * added to while the other three quietly stayed open. A control that has to
 * be remembered in four files is a control that will be missing from one.
 *
 * ## Why a lockout at all
 *
 * A four-digit PIN is 10 000 combinations. The only thing between somebody
 * with a valid session and all of them was `STANDARD_API` at 100 requests per
 * minute — about two minutes of guessing. scrypt makes each attempt
 * expensive for the server, not for the attacker.
 *
 * ## Why it is time-based and self-clearing
 *
 * Because the alternative is worse than the attack. A worker at a machine who
 * mistypes their PIN five times must not need an administrator; a lock that
 * needs clearing by somebody else is a lock that gets worked around by
 * sharing PINs. The delay grows so that guessing stays hopeless while a
 * genuine slip costs a minute.
 *
 * ## Who can trigger it
 *
 * Only the account holder. The PIN is verified for the *authenticated actor*,
 * so failures can only be produced by whoever holds that session — there is
 * no way to lock a colleague out of their shift.
 */

/** Failures allowed before the account starts refusing. */
export const PIN_ATTEMPTS_BEFORE_LOCK = 5;
/**
 * Cap on the growing delay.
 *
 * At 5 attempts per 15 minutes, sweeping all 10 000 combinations of a
 * four-digit PIN takes about three weeks of uninterrupted guessing — half
 * that to expect a hit — and writes an audit event on every attempt. Raising
 * the cap buys little against that; it does cost a person on shift real time,
 * every time they mistype. The figure is asserted in the unit test so it
 * cannot drift into a claim nobody checks.
 */
export const PIN_MAX_LOCK_SECONDS = 15 * 60;

/**
 * How long the account refuses after `failedAttempts` consecutive failures.
 * Zero until the threshold, then doubling from one minute up to the cap.
 *
 * Pure and exported so the shape of the backoff is testable without a
 * database — the numbers are the security argument, and an argument nobody
 * can check is not one.
 */
export function lockSecondsForAttempts(failedAttempts: number): number {
  if (failedAttempts < PIN_ATTEMPTS_BEFORE_LOCK) return 0;
  const doublings = failedAttempts - PIN_ATTEMPTS_BEFORE_LOCK;
  return Math.min(60 * 2 ** doublings, PIN_MAX_LOCK_SECONDS);
}

export interface PinConfirmationContext {
  /** What the person is confirming, for the audit event — e.g.
   *  'work_step.completion' or 'product_release'. */
  purpose: string;
  deviceId?: string;
}

/**
 * Verifies the actor's PIN, or throws.
 *
 * Throws `ConfirmationLockedError` while the account is locked, and
 * `ConfirmationFailedError` for a wrong PIN or an account without one. On
 * success the failure counter resets — the threshold counts CONSECUTIVE
 * failures, so ordinary mistyping over a shift never accumulates into a lock.
 *
 * Deliberately does not run inside the caller's transaction: the counter must
 * survive a rolled-back business transaction, or a failed attempt against a
 * step that then errors for an unrelated reason would cost nothing.
 */
export async function confirmWithPin(
  actor: Actor,
  pin: string,
  context: PinConfirmationContext,
): Promise<void> {
  const user = await withOrgContext(actor.organizationId, (tx) =>
    tx.user.findFirst({
      where: { id: actor.userId },
      select: {
        id: true,
        confirmationPinHash: true,
        confirmationPinFailedAttempts: true,
        confirmationPinLockedUntil: true,
      },
    }),
  );
  if (!user) throw new NotFoundError('Benutzer');

  const now = new Date();
  if (user.confirmationPinLockedUntil && user.confirmationPinLockedUntil > now) {
    const retryAfterSeconds = Math.ceil(
      (user.confirmationPinLockedUntil.getTime() - now.getTime()) / 1000,
    );
    // Not counted as another failure: otherwise hammering a locked account
    // would extend its own lock, and a worker who taps twice would be shut
    // out for a quarter of an hour.
    throw new ConfirmationLockedError(retryAfterSeconds);
  }

  if (!user.confirmationPinHash) {
    throw new ConfirmationFailedError(
      'Für Ihr Konto ist keine Bestätigungs-PIN hinterlegt — bitte an die Administration wenden.',
    );
  }

  if (await verifyConfirmationPin(pin, user.confirmationPinHash)) {
    // Only write when there is something to clear — the overwhelmingly
    // common case is a correct PIN on an untouched counter.
    if (user.confirmationPinFailedAttempts > 0 || user.confirmationPinLockedUntil) {
      await withOrgContext(actor.organizationId, (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { confirmationPinFailedAttempts: 0, confirmationPinLockedUntil: null },
        }),
      );
    }
    return;
  }

  const failedAttempts = user.confirmationPinFailedAttempts + 1;
  const lockSeconds = lockSecondsForAttempts(failedAttempts);
  const lockedUntil = lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000) : null;

  await withOrgContext(actor.organizationId, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        confirmationPinFailedAttempts: failedAttempts,
        confirmationPinLockedUntil: lockedUntil,
      },
    });

    // A wrong PIN on a step confirmation is a security event, not a typo to
    // swallow: the audit trail is where "somebody tried eleven times last
    // Tuesday" becomes answerable. The PIN itself is never written — see
    // confirmation-pin.ts.
    await writeAuditEvent(tx, {
      organizationId: actor.organizationId,
      eventType: lockedUntil ? 'confirmation_pin.locked' : 'confirmation_pin.failed',
      resourceType: 'user',
      resourceId: user.id,
      actorId: actor.userId,
      newValues: {
        purpose: context.purpose,
        failedAttempts,
        lockedUntil: lockedUntil?.toISOString() ?? null,
      },
      result: 'FAILURE',
      failureReason: lockedUntil ? 'CONFIRMATION_LOCKED' : 'CONFIRMATION_FAILED',
      deviceId: context.deviceId,
      source: context.deviceId ? 'mobile' : 'web',
    });
  });

  if (lockedUntil) {
    throw new ConfirmationLockedError(lockSeconds);
  }
  throw new ConfirmationFailedError(
    `Die eingegebene PIN ist nicht korrekt. Noch ${PIN_ATTEMPTS_BEFORE_LOCK - failedAttempts} Versuch(e), ` +
      'danach wird die Bestätigung vorübergehend gesperrt.',
  );
}
