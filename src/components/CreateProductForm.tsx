'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createProductAction, type ProductFormState } from '@/app/projects/actions';

// Der Initialzustand steht hier und nicht neben der Aktion: eine
// `'use server'`-Datei darf ausschließlich async-Funktionen exportieren, ein
// exportiertes Objekt bricht den Build. Gefunden hat das `next build` —
// Typecheck und Lint sehen es nicht.
const INITIAL_PRODUCT_STATE: ProductFormState = { error: null, result: null };

/**
 * Produkt im Projekt anlegen.
 *
 * Bis Phase 7 gab es dafür kein Formular: Produkte entstanden nur im Seed.
 * Ohne Produkt kein Fertigungsplan und kein Auftrag — das Projekt bliebe eine
 * Hülle.
 */
export function CreateProductForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState<ProductFormState, FormData>(
    createProductAction,
    INITIAL_PRODUCT_STATE,
  );

  return (
    <form action={action} className="card">
      <h3>Produkt anlegen</h3>
      <input type="hidden" name="projectId" value={projectId} />
      <label>
        Produktnummer
        <input name="productNumber" required maxLength={50} />
      </label>
      <label>
        Name
        <input name="name" required maxLength={255} />
      </label>
      <label>
        Beschreibung (optional)
        <textarea name="description" rows={2} />
      </label>

      {state.error && (
        <p id="product-form-error" role="alert" className="error-text">
          {state.error}
        </p>
      )}
      {state.result && (
        <p aria-live="polite" className="success-text">
          ✓ {state.result}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="touch-target">
      {pending ? 'Wird angelegt…' : 'Produkt anlegen'}
    </button>
  );
}
