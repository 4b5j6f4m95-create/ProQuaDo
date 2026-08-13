import Link from 'next/link';

import {
  addWorkStepSupplementAction,
  removeWorkStepSupplementAction,
} from '@/app/work-steps/actions';

/**
 * Nachgereichte Unterlagen an diesem Arbeitsschritt.
 *
 * **Der Abschnitt steht bewusst unter den verbindlichen Unterlagen und trägt
 * einen anderen Namen.** Was hier liegt, ist ein Nachweis und keine
 * Arbeitsanweisung: es ändert den Plan nicht, geht nicht in den
 * `documentSetHash` der Freigabe ein und löst keinen Revisionskonflikt aus.
 * Ein Werker, der beides untereinander sieht, muss den Unterschied ohne
 * Erklärung erkennen — deshalb der Satz darüber und nicht nur eine
 * Überschrift.
 */

export interface SupplementView {
  id: string;
  reason: string;
  addedAt: Date;
  addedBy: { displayName: string | null; email: string };
  documentRevision: {
    id: string;
    revisionNumber: string;
    status: string;
    document: { id: string; documentNumber: string; title: string };
  };
}

export interface BindableRevision {
  id: string;
  revisionNumber: string;
  title: string | null;
  document: { documentNumber: string; category: string | null };
}

export function SupplementSection({
  workStepInstanceId,
  supplements,
  bindableRevisions,
  mayManage,
  hasBindings,
}: {
  workStepInstanceId: string;
  supplements: readonly SupplementView[];
  bindableRevisions: readonly BindableRevision[];
  mayManage: boolean;
  /**
   * Ob der Schritt überhaupt verbindliche Unterlagen hat. Der Abschnitt
   * „Verbindliche Unterlagen" wird nur gezeigt, wenn Bindungen bestehen —
   * ohne dieses Wissen verwiese der erklärende Satz auf eine Überschrift,
   * die auf demselben Bildschirm gar nicht steht.
   */
  hasBindings: boolean;
}) {
  // Weder etwas da noch etwas zu tun: dann ist der Abschnitt Rauschen auf
  // einem Tablet, das ohnehin zu wenig Platz hat.
  if (supplements.length === 0 && !mayManage) return null;

  // Was schon beiliegt, gehört nicht mehr in die Auswahlliste. Der
  // Domänendienst weist die Doppelung ohnehin ab — aber eine Liste, die
  // einen Eintrag anbietet, dessen einzige mögliche Antwort eine
  // Fehlermeldung ist, schickt den Benutzer in eine Sackgasse.
  const attached = new Set(supplements.map((supplement) => supplement.documentRevision.id));
  const selectable = bindableRevisions.filter((revision) => !attached.has(revision.id));

  return (
    <section className="card">
      <h2>Nachgereichte Unterlagen ({supplements.length})</h2>
      <p className="muted">
        Nachweise, die nach der Freigabe des Plans dazugekommen sind — etwa eine Zulassung oder eine
        Detailzeichnung. Sie <strong>ändern die Arbeitsanweisung nicht</strong>; verbindlich ist{' '}
        {hasBindings
          ? 'was oben unter „Verbindliche Unterlagen“ steht'
          : 'allein der freigegebene Plan'}
        .
      </p>

      {supplements.length === 0 ? (
        <p className="muted">Nichts nachgereicht.</p>
      ) : (
        <ul>
          {supplements.map((supplement) => (
            <li key={supplement.id}>
              <Link
                className="action-link"
                href={`/documents/${supplement.documentRevision.document.id}`}
              >
                {supplement.documentRevision.document.documentNumber} —{' '}
                {supplement.documentRevision.document.title}
              </Link>{' '}
              · Rev. {supplement.documentRevision.revisionNumber}
              <div className="muted">
                {supplement.reason} · nachgereicht von{' '}
                {supplement.addedBy.displayName ?? supplement.addedBy.email} am{' '}
                {supplement.addedAt.toLocaleDateString('de-DE')}
              </div>
              {mayManage && (
                <form action={removeWorkStepSupplementAction}>
                  <input type="hidden" name="workStepInstanceId" value={workStepInstanceId} />
                  <input type="hidden" name="supplementId" value={supplement.id} />
                  <label>
                    Grund für das Entfernen
                    <input name="reason" required minLength={3} maxLength={500} />
                  </label>
                  <button type="submit" className="link-button">
                    Entfernen
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {mayManage &&
        (selectable.length === 0 ? (
          // Ausgesprochen statt als leere Auswahlliste gezeigt — und die
          // beiden Gründe auseinandergehalten: „noch nicht freigegeben" ist
          // eine Aufgabe für die Qualitätssicherung, „liegt schon bei" ist
          // keine Aufgabe für irgendjemanden.
          <p className="muted">
            {bindableRevisions.length === 0
              ? 'Keine freigegebene Dokumentrevision in diesem Projekt. Erst freigeben, dann nachreichen.'
              : 'Alle freigegebenen Dokumentrevisionen dieses Projekts liegen dem Schritt bereits bei.'}
          </p>
        ) : (
          <form action={addWorkStepSupplementAction}>
            <input type="hidden" name="workStepInstanceId" value={workStepInstanceId} />
            <label>
              Dokumentrevision
              <select name="documentRevisionId" required>
                {selectable.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.document.documentNumber} Rev. {revision.revisionNumber}
                    {revision.title ? ` — ${revision.title}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Warum wird nachgereicht?
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="z. B. Zulassung des Lieferanten lag bei Planfreigabe noch nicht vor"
              />
            </label>
            <button type="submit">Unterlage nachreichen</button>
          </form>
        ))}
    </section>
  );
}
