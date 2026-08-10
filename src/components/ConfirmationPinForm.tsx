'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setConfirmationPinAction, type PinFormState } from '@/app/account/actions';

const INITIAL_STATE: PinFormState = { error: null, result: null };

/**
 * Bestätigungs-PIN setzen oder ändern.
 *
 * `hasPin` entscheidet nur über die Beschriftung und darüber, ob nach der
 * bisherigen PIN gefragt wird — **erzwungen wird beides serverseitig**
 * (set-confirmation-pin.ts). Ein Formular, das ein Feld nicht anzeigt, ist
 * keine Kontrolle.
 */
export function ConfirmationPinForm({ hasPin }: { hasPin: boolean }) {
  const [state, formAction] = useActionState(setConfirmationPinAction, INITIAL_STATE);

  return (
    <form action={formAction} className="card">
      <h2>{hasPin ? 'Bestätigungs-PIN ändern' : 'Bestätigungs-PIN festlegen'}</h2>
      <p className="muted">
        Die PIN ist Ihre Unterschrift: sie wird bei jedem Abschluss eines Arbeitsschritts und bei
        jeder Entscheidung mit Folgen verlangt. Sie gehört Ihnen allein und wird nicht weitergegeben
        — auch nicht an die Administration, die sie weder sehen noch zurücksetzen kann.
      </p>

      {hasPin && (
        <label>
          Bisherige PIN
          <input
            type="password"
            name="currentPin"
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={4}
            maxLength={12}
          />
        </label>
      )}

      <label>
        Neue PIN (4–12 Ziffern)
        <input
          type="password"
          name="newPin"
          inputMode="numeric"
          autoComplete="off"
          required
          minLength={4}
          maxLength={12}
        />
      </label>

      <label>
        Neue PIN wiederholen
        <input
          type="password"
          name="repeatPin"
          inputMode="numeric"
          autoComplete="off"
          required
          minLength={4}
          maxLength={12}
        />
      </label>

      {state.error && (
        <p id="pin-form-error" role="alert" className="error-text">
          {state.error}
        </p>
      )}
      {state.result && (
        <p aria-live="polite" className="success-text">
          ✓ {state.result}
        </p>
      )}

      <SubmitButton hasPin={hasPin} />
    </form>
  );
}

function SubmitButton({ hasPin }: { hasPin: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="touch-target primary">
      {pending ? 'Wird gespeichert…' : hasPin ? 'PIN ändern' : 'PIN festlegen'}
    </button>
  );
}
