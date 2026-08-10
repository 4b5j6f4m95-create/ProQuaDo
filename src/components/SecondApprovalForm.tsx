'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideSecondApprovalAction, type SecondApprovalFormState } from '@/app/quality/actions';

const INITIAL_STATE: SecondApprovalFormState = { error: null };

/**
 * The independent review of a four-eyes step (Abnahmeszenario E). Rendered
 * only when the viewer is NOT the executor — but that is presentation, not
 * protection: the server refuses a self-review with
 * SAME_PERSON_REVIEW_DENIED, and the database refuses to store one at all.
 */
export function SecondApprovalForm({
  workStepInstanceId,
  executorLabel,
}: {
  workStepInstanceId: string;
  executorLabel: string;
}) {
  const [state, formAction] = useActionState(decideSecondApprovalAction, INITIAL_STATE);

  return (
    <form action={formAction} className="card">
      <h2>Vier-Augen-Prüfung</h2>
      <p>
        Ausgeführt von: <strong>{executorLabel}</strong>. Bestätigen Sie die unabhängige Prüfung
        oder lehnen Sie sie mit Begründung ab.
      </p>
      <input type="hidden" name="workStepInstanceId" value={workStepInstanceId} />
      <label>
        Begründung (bei Ablehnung erforderlich)
        <textarea name="reason" rows={2} maxLength={2000} />
      </label>
      <label>
        PIN
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          required
          minLength={4}
          maxLength={12}
          aria-describedby={state.error ? 'second-approval-error' : undefined}
        />
      </label>
      {state.error && (
        <p id="second-approval-error" role="alert" className="error-text">
          {state.error}
        </p>
      )}
      <div className="actions">
        <DecisionButton value="APPROVE" label="Prüfung bestätigen" primary />
        <DecisionButton value="REJECT" label="Ablehnen" />
      </div>
    </form>
  );
}

function DecisionButton({
  value,
  label,
  primary,
}: {
  value: string;
  label: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={value}
      disabled={pending}
      className={`touch-target${primary ? ' primary' : ''}`}
    >
      {pending ? 'Wird verarbeitet…' : label}
    </button>
  );
}
