import Link from 'next/link';

/**
 * Der Bildschirm für „dafür fehlt Ihnen die Berechtigung".
 *
 * **Warum das nicht die Fehlergrenze erledigen kann.** Eine Seite, die
 * `assertPermission` aufruft und die Ablehnung durchreicht, landet in
 * `error.tsx` — und dort steht in einem Production-Build nicht die Meldung
 * des Dienstes, sondern „Minified React error #441". React ersetzt
 * Fehlertexte aus Server-Komponenten, damit nichts nach außen dringt, was
 * nicht sollte. Der Benutzer las also einen Absturz, wo eine Auskunft
 * hingehört: eine fehlende Berechtigung ist **kein Fehler**, sondern eine
 * Antwort.
 *
 * Gefunden auf `/admin`, das jede Rolle in der Menüleiste angeboten bekommt.
 * Wer als Projektleitung darauf klickte, bekam einen React-Fehlercode zu
 * lesen und musste annehmen, die Anwendung sei kaputt.
 *
 * Der Bildschirm nennt deshalb drei Dinge: dass es an der Berechtigung liegt
 * und nicht an einem Defekt, **welche** Berechtigung fehlt — das ist die
 * Auskunft, die eine Anfrage an die Administration überhaupt erst
 * beantwortbar macht — und einen Weg zurück.
 */
export function PermissionDenied({
  /** Was versucht wurde, in der Sprache des Bildschirms: „die Administration". */
  what,
  /** Das Berechtigungsatom, damit die Administration weiß, was zu vergeben ist. */
  permission,
}: {
  what: string;
  permission: string;
}) {
  return (
    <main>
      <h1>Kein Zugriff auf {what}</h1>
      <p className="notice">
        Ihrem Konto fehlt die dafür nötige Berechtigung. Das ist kein Fehler der Anwendung — es ist
        so eingerichtet.
      </p>
      <p>
        Wer den Zugriff braucht, wendet sich an die Administration. Nötig ist die Berechtigung{' '}
        <code>{permission}</code>; mit dieser Angabe lässt sie sich dort ohne Rückfrage vergeben.
      </p>
      <p>
        <Link className="action-link" href="/dashboard">
          ← Zurück zur Übersicht
        </Link>
      </p>
    </main>
  );
}
