'use client';

/**
 * Die letzte Instanz, wenn eine Seite abbricht.
 *
 * **Sie gab bisher `error.message` aus, und das war in Produktion falsch.**
 * React ersetzt Fehlertexte aus Server-Komponenten durch einen Platzhalter,
 * damit keine Interna nach außen dringen. Auf dem Bildschirm stand deshalb
 * „Minified React error #441; visit https://react.dev/errors/441" — für
 * einen Werker in der Halle so hilfreich wie eine leere Seite, und für die
 * Störungssuche auch, weil die Nummer nichts über *diese* Anwendung sagt.
 *
 * Ausgegeben wird jetzt der `digest`. Das ist die Kennung, unter der der
 * Server denselben Fehler protokolliert hat — damit lässt sich ein Anruf aus
 * der Halle mit einer Zeile im Serverprotokoll zusammenbringen, und genau
 * das ist die einzige Auskunft, die diese Seite ehrlich geben kann.
 *
 * **Was hier nicht hingehört, ist eine fehlende Berechtigung.** Die ist kein
 * Fehler, sondern ein Ergebnis, und gehört auf den Bildschirm, der sie
 * ausgelöst hat — siehe `PermissionDenied`. Bis das auf `/admin` so
 * gehandhabt wurde, landete jede Ablehnung hier und sah aus wie ein Defekt.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <h1>Ein Fehler ist aufgetreten</h1>
      <p className="notice">
        Der Vorgang konnte nicht abgeschlossen werden. Ihre bisherige Arbeit ist davon nicht
        betroffen — kein Schritt gilt als abgeschlossen, solange der Server ihn nicht bestätigt hat.
      </p>
      <p>
        Bleibt es nach einem zweiten Versuch dabei, hilft der Störungsstelle diese Kennung weiter:
      </p>
      <p>
        <code>{error.digest ?? 'ohne Kennung (Fehler im Browser, nicht auf dem Server)'}</code>
      </p>
      <button onClick={reset} type="button">
        Erneut versuchen
      </button>
    </main>
  );
}
