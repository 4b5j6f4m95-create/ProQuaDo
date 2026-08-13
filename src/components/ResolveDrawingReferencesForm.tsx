'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  resolveDrawingReferencesAction,
  type ResolveDrawingsFormState,
} from '@/app/production-plans/actions';

const INITIAL_STATE: ResolveDrawingsFormState = { error: null, message: null };

/**
 * Stößt das Nachschlagen der offenen Zeichnungsverweise an.
 *
 * Client-Komponente aus demselben Grund wie die Dokumentbindung: das Ergebnis
 * ist ein Satz, der auf diesem Bildschirm stehen bleiben muss. Ein Knopf, der
 * nur die Seite neu zeichnet, ist bei einem ergebnislosen Lauf von einem
 * kaputten Knopf nicht zu unterscheiden — die Liste sieht danach genauso aus
 * wie davor, und genau das ist ja die Auskunft.
 */
export function ResolveDrawingReferencesForm({
  productionPlanRevisionId,
  openCount,
}: {
  productionPlanRevisionId: string;
  /** Wie viele Verweise gerade offen sind — 0 heißt: nichts nachzuschlagen. */
  openCount: number;
}) {
  const [state, formAction] = useActionState(resolveDrawingReferencesAction, INITIAL_STATE);

  // **Die Entscheidung, ob überhaupt etwas gezeigt wird, gehört hierher und
  // nicht in die Seite.** Der erste Anlauf ließ die Seite entscheiden
  // (`openCount > 0 && <Form/>`). Damit verschwand nach einem erfolgreichen
  // Lauf das ganze Formular — samt der Meldung, die gerade erst entstanden
  // war: die Verweise waren ja nicht mehr offen. Wer den Knopf drückte, sah
  // die Zeichnung unter „Verbindliche Dokumente" auftauchen und bekam kein
  // Wort dazu. Deshalb bleibt das Formular stehen, solange es etwas zu sagen
  // hat.
  if (openCount === 0 && !state.message && !state.error) return null;

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="productionPlanRevisionId" value={productionPlanRevisionId} />
      {openCount > 0 && <SubmitButton />}
      {state.error && (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="muted">
          {state.message}
        </p>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Wird nachgeschlagen…' : 'Zeichnungsverweise nachschlagen'}
    </button>
  );
}
