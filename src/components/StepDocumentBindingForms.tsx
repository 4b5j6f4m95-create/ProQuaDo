'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  bindDocumentToStepAction,
  unbindDocumentFromStepAction,
  type BindingFormState,
} from '@/app/production-plans/actions';

const INITIAL_STATE: BindingFormState = { error: null };

export interface BindableRevision {
  id: string;
  revisionNumber: string;
  title: string;
  document: { documentNumber: string };
}

/**
 * Binding a released document revision to a plan step, and removing one
 * again.
 *
 * Both are client components for one reason: a refused binding has to stay on
 * this screen. The first version used plain server actions that threw, so
 * binding the same revision twice — one double click — replaced the entire
 * plan editor with the error boundary, and the planner lost their place.
 * "Revision 01 ist bereits verknüpft" is an answer, not a crash.
 */
export function BindDocumentForm({
  productionPlanRevisionId,
  planStepId,
  revisions,
}: {
  productionPlanRevisionId: string;
  planStepId: string;
  revisions: readonly BindableRevision[];
}) {
  const [state, formAction] = useFormState(bindDocumentToStepAction, INITIAL_STATE);
  const errorId = `bind-error-${planStepId}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="productionPlanRevisionId" value={productionPlanRevisionId} />
      <input type="hidden" name="planStepId" value={planStepId} />
      <label>
        Dokumentrevision
        <select
          name="documentRevisionId"
          required
          aria-describedby={state.error ? errorId : undefined}
        >
          {revisions.map((revision) => (
            <option key={revision.id} value={revision.id}>
              {revision.document.documentNumber} Rev. {revision.revisionNumber} — {revision.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seite (optional)
        <input name="pageNumber" type="number" min={1} />
      </label>
      <label>
        Markierung (optional)
        <input name="markerLabel" maxLength={100} placeholder="Detail B" />
      </label>
      {state.error && (
        <p id={errorId} role="alert" className="error-text">
          {state.error}
        </p>
      )}
      <SubmitButton label="+ Dokumentbindung" />
    </form>
  );
}

export function UnbindDocumentButton({
  productionPlanRevisionId,
  planStepId,
  bindingId,
}: {
  productionPlanRevisionId: string;
  planStepId: string;
  bindingId: string;
}) {
  const [state, formAction] = useFormState(unbindDocumentFromStepAction, INITIAL_STATE);

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="productionPlanRevisionId" value={productionPlanRevisionId} />
      <input type="hidden" name="planStepId" value={planStepId} />
      <input type="hidden" name="bindingId" value={bindingId} />
      <RemoveButton />
      {state.error && (
        <span role="alert" className="error-text">
          {' '}
          {state.error}
        </span>
      )}
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Wird gespeichert…' : label}
    </button>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="link-button" disabled={pending}>
      {pending ? 'wird entfernt…' : 'entfernen'}
    </button>
  );
}
