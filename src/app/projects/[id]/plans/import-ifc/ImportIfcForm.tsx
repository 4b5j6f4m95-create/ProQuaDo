'use client';

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';

import { suggestPlanIdentity } from '@/lib/ifc/plan-naming';

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
  drawingCount: number;
  boundDrawingCount: number;
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
  const [planNumber, setPlanNumber] = useState('');
  const [name, setName] = useState('');
  const [moduleNumber, setModuleNumber] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  /**
   * Liest die gewählte Datei einmal lokal, nur um die Modulnummer zu finden.
   *
   * Nicht über den Server: das hieße dieselben 23 MB zweimal zu übertragen,
   * einmal für den Vorschlag und einmal für den Import. Der Browser hat die
   * Datei bereits.
   *
   * Die Norm schreibt ISO-8859-1 vor, deshalb `windows-1252` statt der
   * Vorgabe UTF-8 — sonst wird aus jedem Umlaut ein Ersatzzeichen. Für die
   * Modulnummer selbst spielt das selten eine Rolle, für einen Vorschlag,
   * den jemand als Namen übernimmt, schon.
   */
  async function onFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setReading(true);
    try {
      const text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
      const suggestion = suggestPlanIdentity(text);
      setModuleNumber(suggestion?.moduleNumber ?? null);
      // Nur füllen, was leer ist — eine getippte Nummer wird nicht
      // überschrieben, weil jemand die Datei noch einmal auswählt.
      if (suggestion) {
        setPlanNumber((current) => current || suggestion.planNumber);
        setName((current) => current || suggestion.name);
      }
    } catch {
      // Ein misslungener Vorschlag ist kein Fehler: die Felder bleiben leer
      // und werden von Hand gefüllt. Der Server liest die Datei ohnehin neu.
      setModuleNumber(null);
    } finally {
      setReading(false);
    }
  }

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

        {/* Die Zahl der offenen Verweise ist die eigentliche Aussage: eine
            Zeichnung, die das Modell nennt und die niemand hochgeladen hat,
            fehlt später im Schritt. Deshalb steht sie hier und nicht nur in
            den Hinweisen. */}
        {result.drawingCount > 0 && (
          <p>
            <strong>{result.drawingCount}</strong> Zeichnungsverweise aus dem Modell,{' '}
            <strong>{result.boundDrawingCount}</strong> davon an ein freigegebenes Dokument
            gebunden.
            {result.drawingCount > result.boundDrawingCount && (
              <>
                {' '}
                Die übrigen bleiben im jeweiligen Schritt als offener Punkt sichtbar. Wird die
                Zeichnung später hochgeladen und freigegeben, greift sie das Einreichen zur Prüfung
                automatisch auf; im Plan lässt sich das mit <em>
                  Zeichnungsverweise nachschlagen
                </em>{' '}
                auch vorher anstoßen.
              </>
            )}
          </p>
        )}

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
        <input type="file" name="file" accept=".ifc" required onChange={onFileChange} />
      </label>

      {reading && <p aria-live="polite">Datei wird gelesen …</p>}
      {moduleNumber && (
        <p aria-live="polite">
          Modul <strong>{moduleNumber}</strong> erkannt — Plannummer und Name sind daraus
          vorgeschlagen und lassen sich ändern.
        </p>
      )}

      <label>
        Plannummer
        <input
          name="planNumber"
          required
          maxLength={50}
          value={planNumber}
          onChange={(e) => setPlanNumber(e.currentTarget.value)}
        />
      </label>
      <label>
        Name
        <input
          name="name"
          required
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
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
