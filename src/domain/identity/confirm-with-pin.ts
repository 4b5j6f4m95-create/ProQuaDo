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
  const now = new Date();

  // ── Versuch anmelden, **bevor** er geprüft wird ──────────────
  const reservation = await reserveAttempt(actor, now, context);

  if (reservation.kind === 'MISSING') throw new NotFoundError('Benutzer');
  if (reservation.kind === 'NO_PIN') {
    throw new ConfirmationFailedError(
      'Für Ihr Konto ist keine Bestätigungs-PIN hinterlegt — bitte an die Administration wenden.',
    );
  }
  if (reservation.kind === 'LOCKED') {
    throw new ConfirmationLockedError(reservation.retryAfterSeconds);
  }
  if (reservation.kind === 'TOO_MANY_IN_FLIGHT') {
    // Der Versuch wird **nicht geprüft**. Das ist der Sinn der Anmeldung:
    // gleichzeitige Versuche bekommen fortlaufende Nummern, und wer über die
    // Grenze hinaus kommt, rät nicht mehr mit.
    throw new ConfirmationLockedError(reservation.retryAfterSeconds);
  }

  const { hash, attempt } = reservation;

  // Die Prüfung selbst läuft **außerhalb** jeder Transaktion. scrypt ist
  // absichtlich teuer; hielte man dabei die Zeile gesperrt, könnte ein
  // einzelnes Konto den Verbindungspool blockieren — eine Abwehr, die zur
  // Selbstbehinderung wird.
  if (await verifyConfirmationPin(pin, hash)) {
    await withOrgContext(actor.organizationId, (tx) =>
      tx.user.update({
        where: { id: actor.userId },
        data: { confirmationPinFailedAttempts: 0, confirmationPinLockedUntil: null },
      }),
    );
    return;
  }

  const lockSeconds = lockSecondsForAttempts(attempt);
  const lockedUntil = lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000) : null;

  await withOrgContext(actor.organizationId, async (tx) => {
    if (lockedUntil) {
      await tx.user.update({
        where: { id: actor.userId },
        data: { confirmationPinLockedUntil: lockedUntil },
      });
    }

    // A wrong PIN on a step confirmation is a security event, not a typo to
    // swallow: the audit trail is where "somebody tried eleven times last
    // Tuesday" becomes answerable. The PIN itself is never written — see
    // confirmation-pin.ts.
    await writeAuditEvent(tx, {
      organizationId: actor.organizationId,
      eventType: lockedUntil ? 'confirmation_pin.locked' : 'confirmation_pin.failed',
      resourceType: 'user',
      resourceId: actor.userId,
      actorId: actor.userId,
      newValues: {
        purpose: context.purpose,
        failedAttempts: attempt,
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
    `Die eingegebene PIN ist nicht korrekt. Noch ${PIN_ATTEMPTS_BEFORE_LOCK - attempt} Versuch(e), ` +
      'danach wird die Bestätigung vorübergehend gesperrt.',
  );
}

type Reservation =
  | { kind: 'MISSING' }
  | { kind: 'NO_PIN' }
  | { kind: 'LOCKED'; retryAfterSeconds: number }
  | { kind: 'TOO_MANY_IN_FLIGHT'; retryAfterSeconds: number }
  | { kind: 'RESERVED'; hash: string; attempt: number };

/**
 * Zählt den Versuch, bevor er geprüft wird, und gibt seine laufende Nummer
 * zurück.
 *
 * **Warum vorher und nicht nachher.** Vorher wurde gelesen, dann geprüft,
 * dann der Zähler **absolut** zurückgeschrieben
 * (`confirmationPinFailedAttempts + 1`). Bei READ COMMITTED — und die
 * Isolationsstufe wird nirgends angehoben — lesen gleichzeitige Versuche
 * alle denselben Stand und schreiben alle dieselbe Zahl: **20 Fehlversuche
 * ergaben den Zähler 1**, das Konto wurde nie gesperrt, und die richtige PIN
 * galt danach weiter. Nachgewiesen in
 * `test/integration/phase7-confirmation-pin-race.integration.test.ts`.
 *
 * Das ist keine Kleinigkeit: der Kommentar an
 * `users.confirmation_pin_failed_attempts` benennt die Sperre selbst als den
 * Schutz, den eine vierstellige PIN hinter 100 Anfragen je Minute braucht.
 * Ohne sie ist der Raum in gut einer Stunde durchprobiert — und wer eine
 * fremde PIN hat, zeichnet in fremdem Namen ab (ADR-005).
 *
 * **Ein atomares `increment` allein genügt nicht.** Es macht den Zähler
 * richtig, aber alle gleichzeitigen Versuche sind dann bereits geprüft,
 * bevor die Sperre greift — ein Angreifer bekäme je Sperrfenster so viele
 * Rateversuche, wie er gleichzeitig abschicken kann. Deshalb wird die Nummer
 * **vor** der Prüfung vergeben und alles jenseits der Grenze gar nicht erst
 * geprüft.
 *
 * Gezählt werden damit begonnene Versuche, nicht nur gescheiterte. Eine
 * richtige PIN setzt den Zähler zurück; für den Nutzer ändert sich nichts.
 */
async function reserveAttempt(
  actor: Actor,
  now: Date,
  context: PinConfirmationContext,
): Promise<Reservation> {
  return withOrgContext(actor.organizationId, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: actor.userId },
      select: {
        id: true,
        confirmationPinHash: true,
        confirmationPinLockedUntil: true,
      },
    });
    if (!user) return { kind: 'MISSING' };

    if (user.confirmationPinLockedUntil && user.confirmationPinLockedUntil > now) {
      // Not counted as another failure: otherwise hammering a locked account
      // would extend its own lock, and a worker who taps twice would be shut
      // out for a quarter of an hour.
      return {
        kind: 'LOCKED',
        retryAfterSeconds: secondsUntil(user.confirmationPinLockedUntil, now),
      };
    }

    if (!user.confirmationPinHash) return { kind: 'NO_PIN' };

    // `increment` und nicht „lesen, rechnen, schreiben": Postgres führt
    // `SET x = x + 1` unter der Zeilensperre aus, gleichzeitige Versuche
    // reihen sich damit auf und bekommen jeder eine eigene Nummer.
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { confirmationPinFailedAttempts: { increment: 1 } },
      select: { confirmationPinFailedAttempts: true },
    });
    const attempt = updated.confirmationPinFailedAttempts;

    if (attempt > PIN_ATTEMPTS_BEFORE_LOCK) {
      // Jenseits der Grenze wird nicht mehr geprüft. Die Sperre wird hier
      // gesetzt, weil dieser Weg an der Fehlerbehandlung unten vorbeiläuft —
      // sonst zählte der Angreifer weiter hoch, ohne dass je gesperrt würde.
      const lockSeconds = lockSecondsForAttempts(attempt);
      const lockedUntil = new Date(now.getTime() + lockSeconds * 1000);
      await tx.user.update({
        where: { id: user.id },
        data: { confirmationPinLockedUntil: lockedUntil },
      });

      // **Auch ein ungeprüfter Versuch gehört ins Audit.** Vor der Korrektur
      // schrieb jeder Versuch ein Ereignis, weil jeder bis zur Prüfung kam;
      // dieser Weg bricht davor ab und würde die Spur sonst genau dort dünner
      // machen, wo jemand offensichtlich rät.
      await writeAuditEvent(tx, {
        organizationId: actor.organizationId,
        eventType: 'confirmation_pin.locked',
        resourceType: 'user',
        resourceId: user.id,
        actorId: actor.userId,
        newValues: {
          purpose: context.purpose,
          failedAttempts: attempt,
          lockedUntil: lockedUntil.toISOString(),
          notVerified: true,
        },
        result: 'FAILURE',
        failureReason: 'CONFIRMATION_LOCKED',
        deviceId: context.deviceId,
        source: context.deviceId ? 'mobile' : 'web',
      });

      return { kind: 'TOO_MANY_IN_FLIGHT', retryAfterSeconds: lockSeconds };
    }

    return { kind: 'RESERVED', hash: user.confirmationPinHash, attempt };
  });
}

function secondsUntil(moment: Date, now: Date): number {
  return Math.ceil((moment.getTime() - now.getTime()) / 1000);
}
