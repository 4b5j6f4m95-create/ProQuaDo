'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * **Warum `fetch` gegen die Route und keine Server Action.** Server Actions
 * nehmen standardmäßig 1 MB Formulardaten entgegen; die Beispieldatei eines
 * einzigen Moduls misst 23 MB. Der Upload wäre also nicht langsam gewesen,
 * sondern abgewiesen — und zwar mit einer Meldung, die nach einem
 * Netzwerkfehler aussieht. Deshalb geht die Datei an den Route Handler, der
 * keine solche Grenze kennt.
 */
export interface ProductOption {
  id: string;
  name: string;
}

interface ImportResult {
  planId: string;
  revisionId: string;
  stepCount: number;
  componentCount: number;
  warnings: string[];
}

export function ImportIfcForm({
  projectId,
  products,
}: {
  projectId: string;
  products: readonly ProductOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);

    const body = new FormData(event.currentTarget);
    body.set('projectId', projectId);

    try {
      const response = await fetch('/api/v1/production-plans/import-ifc', {
        method: 'POST',
        body,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? String((payload as { detail: unknown }).detail)
            : 'Der Import ist fehlgeschlagen.';
        setError(detail);
        return;
      }

      setResult(payload as ImportResult);
    } catch {
      // Eine abgebrochene Verbindung bei 23 MB ist der wahrscheinlichste
      // Fehlerfall in einer Halle mit WLAN.
      setError('Die Verbindung wurde unterbrochen. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <section aria-live="polite">
        <h2>Import abgeschlossen</h2>
        <p>
          <strong>{result.stepCount}</strong> Arbeitsschritte mit{' '}
          <strong>{result.componentCount}</strong> Bauteilen angelegt. Der Plan steht im{' '}
          <strong>Entwurf</strong> und muss wie jeder andere eingereicht, von der Qualitätssicherung
          genehmigt und freigegeben werden.
        </p>

        {result.warnings.length > 0 && (
          <div role="alert">
            <h3>Hinweise aus der Datei</h3>
            <ul>
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p>
              Diese Hinweise stehen dauerhaft am Import und im Audit-Trail. Wenn Bauteile fehlen,
              die verbaut werden müssen, gehört das mit dem Ersteller der Datei geklärt — nicht hier
              korrigiert.
            </p>
          </div>
        )}

        <button type="button" onClick={() => router.push(`/production-plans/${result.revisionId}`)}>
          Plan öffnen
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        IFC-Datei
        <input type="file" name="file" accept=".ifc" required />
      </label>
      <label>
        Plannummer
        <input name="planNumber" required maxLength={50} />
      </label>
      <label>
        Name
        <input name="name" required maxLength={255} />
      </label>
      <label>
        Produkt
        <select name="productId" required>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy ? 'Datei wird gelesen …' : 'Importieren'}
      </button>
      {busy && (
        <p aria-live="polite">
          Große Modelle brauchen einen Moment — die Datei wird hochgeladen, auf Schadsoftware
          geprüft und gelesen.
        </p>
      )}
    </form>
  );
}
