'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  exportDossierAction,
  type ExportFormState,
} from '@/app/production-orders/[id]/dossier/actions';

const INITIAL_STATE: ExportFormState = { error: null, downloadUrl: null, summary: null };

/**
 * Export as PDF or ZIP. Generation is synchronous (ADR-007), so the button
 * stays disabled until it finishes rather than showing a job that has to be
 * polled — for one order's dossier that is the shorter path to the file.
 *
 * The download link is a short-lived signed URL to object storage; it is not
 * re-rendered on navigation, which is why the summary states the hash the
 * export produced.
 */
export function DossierExportForm({ productionOrderId }: { productionOrderId: string }) {
  const [state, formAction] = useFormState(exportDossierAction, INITIAL_STATE);

  return (
    <form action={formAction} className="card">
      <h2>Export</h2>
      <input type="hidden" name="productionOrderId" value={productionOrderId} />
      <p className="muted">
        Das ZIP enthält die Akte als PDF, alle Originalnachweise und ein Manifest, das jede Datei
        per SHA-256 bestätigt.
      </p>
      <div className="actions">
        <ExportButton format="PDF" label="Als PDF exportieren" />
        <ExportButton format="ZIP" label="Als ZIP mit Nachweisen exportieren" primary />
      </div>

      {state.error && (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      )}

      {state.downloadUrl && (
        <p aria-live="polite">
          ✓ {state.summary}
          <br />
          <a className="button-link" href={state.downloadUrl}>
            Download starten
          </a>
          <br />
          <span className="muted">Der Downloadlink ist zeitlich begrenzt gültig.</span>
        </p>
      )}
    </form>
  );
}

function ExportButton({
  format,
  label,
  primary,
}: {
  format: string;
  label: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="format"
      value={format}
      disabled={pending}
      className={`touch-target${primary ? ' primary' : ''}`}
    >
      {pending ? 'Akte wird erzeugt…' : label}
    </button>
  );
}
