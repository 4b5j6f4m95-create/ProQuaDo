import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { hashConfirmationPin } from '@/lib/auth/confirmation-pin';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import { confirmWithPin } from './confirm-with-pin';
import type { Actor } from '@/domain/shared/actor';

/**
 * Setzt oder ändert die Bestätigungs-PIN — **für das eigene Konto, und nur
 * dafür**.
 *
 * ## Warum es das bisher nicht gab, und warum das ein Problem war
 *
 * `users.confirmation_pin_hash` wurde bis hierher an genau einer Stelle
 * geschrieben: im Seed, mit einem festen Demo-Wert. Ohne PIN lässt sich kein
 * Arbeitsschritt abschließen, keine Vier-Augen-Entscheidung treffen und keine
 * Produktfreigabe erteilen (ADR-005) — ein neu angelegtes echtes Konto war
 * damit arbeitsunfähig, und der einzige Ausweg wäre ein von Hand erzeugter
 * scrypt-Hash in der Datenbank gewesen.
 *
 * ## Warum es keinen administrativen Weg gibt
 *
 * Die PIN ist die Unterschrift. Wer sie für jemand anderen vergibt, kennt sie
 * — und ab da steht im Audit-Trail eine Zurechnung, die nicht mehr trägt. Aus
 * demselben Grund löst sich die Fehlversuchssperre selbst auf, statt von der
 * Administration aufgehoben zu werden (siehe confirm-with-pin.ts): jede
 * Bequemlichkeit an dieser Stelle wird mit geteilten PINs bezahlt.
 *
 * Folge für den Betrieb: ein neuer Mensch meldet sich einmal an und setzt
 * seine PIN selbst, bevor er arbeiten kann. Das gehört in die Schulung
 * (docs/15), nicht in ein Administrationswerkzeug.
 *
 * ## Warum das Ändern die alte PIN verlangt
 *
 * Ohne diese Rückfrage wäre eine übernommene Sitzung genug, um die
 * Unterschrift des Kontoinhabers zu **ersetzen** statt sie nur zu benutzen —
 * und der Nächste am geteilten Tablet könnte im Namen des Vorgängers
 * bestätigen. Geprüft wird über `confirmWithPin`, also über dieselbe eine
 * Stelle wie überall sonst: damit gilt hier die Fehlversuchssperre mit, ohne
 * dass sie ein zweites Mal implementiert werden müsste.
 *
 * Beim **ersten** Setzen gibt es nichts zurückzufragen — ein Konto ohne PIN
 * hat keine Unterschrift, die geschützt werden könnte.
 */
export interface SetConfirmationPinCommand {
  actor: Actor;
  /** Die neue PIN. 4–12 Ziffern; sie wird nie gespeichert, nur ihr Hash. */
  newPin: string;
  /** Die bisherige PIN. Pflicht, sobald eine hinterlegt ist. */
  currentPin?: string;
}

export interface SetConfirmationPinResult {
  /** `true`, wenn das Konto vorher keine PIN hatte. */
  wasFirstTime: boolean;
}

export async function setConfirmationPin(
  command: SetConfirmationPinCommand,
): Promise<SetConfirmationPinResult> {
  const { actor, newPin, currentPin } = command;

  // Kein `assertPermission`: das ist keine Berechtigungsfrage, sondern eine
  // Kontofrage. Es gibt kein Atom dafür, weil es keinen Weg geben soll, das
  // für jemand anderen zu tun — geschrieben wird ausschließlich für
  // `actor.userId`.
  const user = await withOrgContext(actor.organizationId, (tx) =>
    tx.user.findFirst({
      where: { id: actor.userId },
      select: { id: true, confirmationPinHash: true },
    }),
  );
  if (!user) throw new NotFoundError('Benutzer');

  assertUsablePin(newPin);

  const wasFirstTime = !user.confirmationPinHash;
  if (!wasFirstTime) {
    if (!currentPin) {
      throw new ValidationError('Zum Ändern der PIN ist die bisherige PIN erforderlich.');
    }
    // Wirft ConfirmationFailedError bzw. ConfirmationLockedError. Bewusst vor
    // dem Hashen der neuen PIN: eine falsche alte PIN darf keine Arbeit
    // auslösen und muss als Fehlversuch zählen.
    await confirmWithPin(actor, currentPin, { purpose: 'confirmation_pin.change' });
  }

  const confirmationPinHash = await hashConfirmationPin(newPin);

  await withOrgContext(actor.organizationId, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        confirmationPinHash,
        // Eine frisch gesetzte PIN startet mit sauberem Zähler. Andernfalls
        // trüge eine neue Unterschrift die Fehlversuche der alten.
        confirmationPinFailedAttempts: 0,
        confirmationPinLockedUntil: null,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: actor.organizationId,
      eventType: wasFirstTime ? 'confirmation_pin.set' : 'confirmation_pin.changed',
      resourceType: 'user',
      resourceId: user.id,
      actorId: actor.userId,
      // Weder die alte noch die neue PIN, und auch kein Hash: der Audit-Trail
      // hält fest, DASS die Unterschrift gewechselt hat, nicht womit.
      newValues: { confirmationPin: '[REDACTED]' },
      source: 'web',
      result: 'SUCCESS',
    });
  });

  return { wasFirstTime };
}

/**
 * Die PIN-Regel als reine Funktion — gibt die Beanstandung zurück oder `null`.
 *
 * Ausgelagert und exportiert aus demselben Grund wie `lockSecondsForAttempts`
 * in confirm-with-pin.ts: sie ist ein Sicherheitsargument, und ein Argument,
 * das niemand nachprüfen kann, ist keines. So steht sie in einem Unit-Test
 * ohne Datenbank.
 *
 * Formatprüfung mit einer deutschen, zeigbaren Meldung.
 *
 * `assertPinFormat` aus der Krypto-Schicht wirft einen nackten `Error` mit
 * englischem Text — richtig dort, wo er einen Programmierfehler anzeigt, aber
 * unbrauchbar für ein Formular, in das gerade jemand `12` getippt hat.
 *
 * Die Trivialprüfungen darüber hinaus sind bewusst knapp gehalten: eine PIN
 * ist vierstellig kurz, und eine lange Verbotsliste verschiebt nur, welche
 * schwache Wahl übrig bleibt. `1111` und `1234` auszuschließen kostet nichts
 * und nimmt die beiden Muster weg, die sonst die halbe Schicht benutzt.
 *
 * **Folge, die man kennen muss:** die Demo-PIN `1234` aus dem Seed lässt sich
 * hier nicht setzen. Das ist kein Widerspruch, sondern der Punkt — der Seed
 * schreibt den Hash unmittelbar und ist ausdrücklich nur für Demo und Test
 * gedacht. In einer Schulung heißt das: zum Üben eine andere PIN wählen.
 */
export function pinPolicyViolation(pin: string): string | null {
  if (!/^\d{4,12}$/.test(pin)) return 'Die PIN muss aus 4 bis 12 Ziffern bestehen.';
  if (/^(\d)\1*$/.test(pin)) return 'Die PIN darf nicht aus einer einzigen Ziffer bestehen.';
  if (isSequential(pin)) return 'Die PIN darf keine fortlaufende Ziffernfolge sein.';
  return null;
}

function assertUsablePin(pin: string): void {
  const violation = pinPolicyViolation(pin);
  if (violation) throw new ValidationError(violation);
}

function isSequential(pin: string): boolean {
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i += 1) {
    const previous = Number(pin[i - 1]);
    const current = Number(pin[i]);
    if (current !== previous + 1) ascending = false;
    if (current !== previous - 1) descending = false;
  }
  return ascending || descending;
}
