'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  decideProductReleaseAction,
  type ProductReleaseFormState,
} from '@/app/production-orders/[id]/dossier/actions';

const INITIAL_STATE: ProductReleaseFormState = { error: null, result: null };

/**
 * The product release decision, in section 9 of the dossier and nowhere else
 * — the decision belongs beside the evidence it is made on, not on a separate
 * screen where it could be given without looking.
 *
 * `blockers` disables the release button and says why. That is presentation:
 * the server re-checks every condition (decideProductRelease), so a stale
 * page cannot release a product whose last blocking NCR reopened a second
 * ago. Rejecting stays available even when blockers exist — refusing a
 * product is exactly what one does when something is wrong with it.
 */
export function ProductReleaseForm({
  productionOrderId,
  blockers,
}: {
  productionOrderId: string;
  blockers: readonly string[];
}) {
  const [state, formAction] = useActionState(decideProductReleaseAction, INITIAL_STATE);
  const blocked = blockers.length > 0;

  return (
    <form action={formAction}>
      <h3>Produktfreigabe entscheiden</h3>
      <input type="hidden" name="productionOrderId" value={productionOrderId} />

      {blocked && (
        <p className="error-text">
          Eine Freigabe ist derzeit nicht möglich: {blockers.join('; ')}.
        </p>
      )}

      <label>
        Begründung (immer erforderlich)
        <textarea
          name="reason"
          rows={3}
          maxLength={4000}
          required
          placeholder="Worauf stützt sich die Entscheidung?"
        />
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
          aria-describedby={state.error ? 'product-release-error' : undefined}
        />
      </label>

      {state.error && (
        <p id="product-release-error" role="alert" className="error-text">
          {state.error}
        </p>
      )}
      {state.result && (
        <p role="status" className="success-text">
          {state.result}
        </p>
      )}

      <div className="actions">
        <DecisionButton value="RELEASED" label="Produkt freigeben" primary disabled={blocked} />
        <DecisionButton value="REJECTED" label="Freigabe ablehnen" />
      </div>
      <p className="muted">
        Eine erteilte Freigabe kann hier nicht zurückgenommen werden — eine Rücknahme ist ein
        Rückruf, keine Korrektur.
      </p>
    </form>
  );
}

function DecisionButton({
  value,
  label,
  primary,
  disabled,
}: {
  value: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={value}
      disabled={pending || disabled}
      className={`touch-target${primary ? ' primary' : ''}`}
    >
      {pending ? 'Wird verarbeitet…' : label}
    </button>
  );
}
