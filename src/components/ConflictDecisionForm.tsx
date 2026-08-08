'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { decideConflictAction, type ConflictDecisionFormState } from '@/app/sync/actions';
import {
  DECISION_CONSEQUENCE,
  DECISION_LABEL,
  type ConflictDecisionType,
} from '@/domain/sync/conflict-types';

const INITIAL_STATE: ConflictDecisionFormState = { error: null, resultingAction: null };

/**
 * The decision surface from docs/07 B4 — the radio list, a mandatory reason
 * and a PIN.
 *
 * The consequence of the selected option is shown BEFORE the button, not
 * after the click: "Wiederholung erforderlich" retires a completed execution
 * and re-releases the step, and nobody should discover that from the result
 * screen. Which options appear at all comes from the server's own
 * `availableDecisions` — the same list `isDecisionAllowed` enforces, so the
 * UI cannot offer something the server would refuse.
 */
export function ConflictDecisionForm({
  conflictId,
  availableDecisions,
}: {
  conflictId: string;
  availableDecisions: readonly ConflictDecisionType[];
}) {
  const [state, formAction] = useFormState(decideConflictAction, INITIAL_STATE);
  const [selected, setSelected] = useState<ConflictDecisionType | null>(null);

  if (state.resultingAction) {
    return (
      <section className="card done-card" aria-live="polite">
        <h2>✓ Entscheidung erfasst</h2>
        <p>{state.resultingAction}</p>
      </section>
    );
  }

  return (
    <form action={formAction} className="card">
      <h2>Entscheidung</h2>
      <input type="hidden" name="conflictId" value={conflictId} />

      <fieldset>
        <legend>Wie soll fortgefahren werden?</legend>
        {availableDecisions.map((decision) => (
          <label key={decision} className="radio-option touch-target">
            <input
              type="radio"
              name="decision"
              value={decision}
              required
              onChange={() => setSelected(decision)}
            />
            {DECISION_LABEL[decision]}
          </label>
        ))}
      </fieldset>

      {selected && (
        <p className="notice" aria-live="polite">
          {DECISION_CONSEQUENCE[selected]}
        </p>
      )}

      <label>
        Begründung
        <textarea name="reason" rows={3} required maxLength={4000} />
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
          aria-describedby={state.error ? 'conflict-decision-error' : undefined}
        />
      </label>

      {state.error && (
        <p id="conflict-decision-error" role="alert" className="error-text">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary touch-target" disabled={pending}>
      {pending ? 'Wird verarbeitet…' : 'Entscheidung bestätigen'}
    </button>
  );
}
