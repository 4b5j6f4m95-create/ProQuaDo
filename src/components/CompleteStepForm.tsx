'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { completeWorkStepAction, type CompleteStepFormState } from '@/app/work-steps/actions';

const INITIAL_STATE: CompleteStepFormState = { error: null };

/**
 * Confirmation dialog from docs/07 A5. Client Component only so that a
 * failed confirmation (wrong PIN) can be shown inline instead of throwing
 * the worker out to an error page.
 *
 * `openRequirements > 0` disables the button — mirroring "Abschließen
 * (2 fehlend) [deaktiviert]" in the wireflow. That is a convenience, not a
 * control: the server re-evaluates every requirement before completing
 * anything, so a client that submits anyway is simply rejected.
 */
export function CompleteStepForm({
  workStepInstanceId,
  confirmationText,
  openRequirements,
}: {
  workStepInstanceId: string;
  confirmationText: string;
  openRequirements: number;
}) {
  const [state, formAction] = useFormState(completeWorkStepAction, INITIAL_STATE);

  return (
    <form action={formAction} className="card">
      <input type="hidden" name="workStepInstanceId" value={workStepInstanceId} />
      <p>{confirmationText}</p>
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
          aria-describedby={state.error ? 'pin-error' : undefined}
        />
      </label>
      {state.error && (
        <p id="pin-error" role="alert" className="error-text">
          {state.error}
        </p>
      )}
      <SubmitButton openRequirements={openRequirements} />
    </form>
  );
}

function SubmitButton({ openRequirements }: { openRequirements: number }) {
  const { pending } = useFormStatus();
  const blocked = openRequirements > 0;

  return (
    <button type="submit" className="primary touch-target" disabled={blocked || pending}>
      {pending
        ? 'Wird geprüft…'
        : blocked
          ? `Abschließen (${openRequirements} fehlend)`
          : 'Bestätigen und abschließen'}
    </button>
  );
}
