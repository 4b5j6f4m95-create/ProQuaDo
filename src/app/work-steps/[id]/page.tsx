import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getWorkStepInstance, listWorkStepsOfOrder } from '@/domain/execution/execution-queries';
import { STEP_CONFIRMATION_TEXT } from '@/domain/execution/complete-work-step';
import { openRequirementCount } from '@/domain/execution/step-requirements';
import { StatusChip } from '@/components/StatusChip';
import { CompleteStepForm } from '@/components/CompleteStepForm';
import { PhotoCaptureWidget } from '@/components/PhotoCaptureWidget';
import {
  pauseWorkStepAction,
  recordChecklistResponseAction,
  recordMeasurementAction,
  reopenRejectedStepAction,
  resumeWorkStepAction,
  startWorkStepAction,
} from '../actions';

const RESPONSE_OPTIONS = ['OK', 'NOK', 'N/A'] as const;

/** Arbeitsschritt-Ansicht — docs/07_WIREFLOWS_UX.md A2–A6. */
export default async function WorkStepPage({ params }: { params: { id: string } }) {
  const actor = await requirePageAuth();
  const step = await getWorkStepInstance(actor, params.id);
  const siblings = await listWorkStepsOfOrder(actor, step.productionOrderId);

  const openCount = openRequirementCount(step.evaluation);
  const canWork = step.isAssignedToOrder;
  const responseByItemId = new Map(step.checklistResponses.map((r) => [r.checklistItemId, r]));
  const measurementByCharacteristicId = new Map(
    step.measurementResults.map((m) => [m.inspectionCharacteristicId, m]),
  );
  const completedPhotos = step.photoEvidence.filter((p) => p.uploadStatus === 'COMPLETED');
  const rejectionReasons = parseReasons(step.completionSubmission?.validationReason ?? null);
  const nextStep = siblings.find((s) => s.stepNumber > step.stepNumber);

  return (
    <main className="tablet">
      <p>
        <Link href={`/production-orders/${step.productionOrderId}`}>
          ← {step.productionOrder.orderNumber}
        </Link>
      </p>

      <h1>
        Schritt {step.stepNumber} von {siblings.length}: {step.planStep.title}
      </h1>
      <p aria-live="polite">
        <StatusChip status={step.status} />
        {step.planStep.fourEyesRequired && (
          <span className="status-chip">👥 Vier-Augen-Pflicht</span>
        )}
      </p>

      {step.planStep.description && <p>{step.planStep.description}</p>}
      {step.planStep.instruction && (
        <section className="card">
          <h2>Arbeitsanweisung</h2>
          <p>{step.planStep.instruction}</p>
        </section>
      )}

      {step.planStep.documentBindings.length > 0 && (
        <section className="card">
          <h2>Verbindliche Unterlagen</h2>
          <ul>
            {step.planStep.documentBindings.map((binding) => (
              <li key={binding.id}>
                <Link href={`/documents/${binding.document.id}`}>
                  {binding.document.documentNumber} — {binding.document.title}
                </Link>{' '}
                · Rev. {binding.documentRevision.revisionNumber}{' '}
                <StatusChip status={binding.documentRevision.status} />
                {binding.pageNumber ? ` · Seite ${binding.pageNumber}` : ''}
                {binding.markerLabel ? ` · ${binding.markerLabel}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canWork && (
        <p className="notice">
          Sie sind diesem Auftrag nicht zugewiesen und können den Schritt daher nur einsehen.
        </p>
      )}

      {step.status === 'READY' && canWork && (
        <form action={startWorkStepAction}>
          <input type="hidden" name="workStepInstanceId" value={step.id} />
          <button type="submit" className="primary touch-target">
            Arbeitsschritt starten
          </button>
        </form>
      )}

      {step.status === 'PAUSED' && canWork && (
        <form action={resumeWorkStepAction}>
          <input type="hidden" name="workStepInstanceId" value={step.id} />
          <button type="submit" className="primary touch-target">
            Fortsetzen
          </button>
        </form>
      )}

      {step.status === 'LOCKED' && (
        // The visual manifestation of the central invariant (docs/07 A7):
        // no start button, and an explicit reason.
        <p className="notice locked-notice">
          🔒 Dieser Arbeitsschritt ist gesperrt. Er wird erst freigegeben, nachdem der Server den
          Abschluss aller Vorgängerschritte geprüft und bestätigt hat.
        </p>
      )}

      {step.status === 'VALIDATING' && (
        <p className="notice" aria-live="polite">
          ⏳ Der Abschluss wird serverseitig geprüft.
        </p>
      )}

      {step.status === 'AWAITING_SECOND_APPROVAL' && (
        <p className="notice">
          👥 Ausführung bestätigt. Der Schritt gilt erst als abgeschlossen, wenn eine zweite,
          unabhängige Person die Prüfung bestätigt hat.
        </p>
      )}

      {step.status === 'COMPLETION_REJECTED' && (
        <section className="card blocked-card">
          <h2>⚠ Abschluss abgelehnt</h2>
          <ul>
            {rejectionReasons.map((reason) => (
              <li key={`${reason.code}-${reason.affectedField ?? ''}`}>{reason.detail}</li>
            ))}
          </ul>
          {canWork && (
            <form action={reopenRejectedStepAction}>
              <input type="hidden" name="workStepInstanceId" value={step.id} />
              <button type="submit" className="touch-target">
                Nachbessern
              </button>
            </form>
          )}
        </section>
      )}

      {step.status === 'COMPLETED' && (
        <section className="card done-card">
          <h2>✓ Schritt {step.stepNumber} abgeschlossen</h2>
          {nextStep && nextStep.status === 'READY' ? (
            <p>
              Schritt {nextStep.stepNumber} wurde freigegeben.{' '}
              <Link className="button-link" href={`/work-steps/${nextStep.id}`}>
                Weiter →
              </Link>
            </p>
          ) : nextStep ? (
            <p>
              Folgeschritt {nextStep.stepNumber}: <StatusChip status={nextStep.status} /> — noch
              nicht für Sie freigegeben.
            </p>
          ) : (
            <p>Dies war der letzte Arbeitsschritt dieses Auftrags.</p>
          )}
        </section>
      )}

      <section>
        <h2>
          Checkliste ({step.checklistResponses.filter((r) => r.response === 'OK').length}/
          {step.planStep.checklistItems.length})
        </h2>
        {step.planStep.checklistItems.length === 0 && (
          <p className="muted">Keine Checkliste hinterlegt.</p>
        )}
        {step.planStep.checklistItems.map((item) => {
          const response = responseByItemId.get(item.id);
          return (
            <div key={item.id} className="card checklist-row">
              <p>
                <strong>
                  {item.itemNumber}. {item.text}
                </strong>
                {item.isRequired ? '' : ' (optional)'}
                {response ? ` — ${response.response}` : ''}
              </p>
              {step.status === 'IN_PROGRESS' && canWork && (
                <form action={recordChecklistResponseAction} className="inline-form">
                  <input type="hidden" name="workStepInstanceId" value={step.id} />
                  <input type="hidden" name="checklistItemId" value={item.id} />
                  <fieldset>
                    <legend className="visually-hidden">Bewertung für {item.text}</legend>
                    {RESPONSE_OPTIONS.map((option) => (
                      <label key={option} className="radio-option touch-target">
                        <input
                          type="radio"
                          name="response"
                          value={option}
                          defaultChecked={response?.response === option}
                          required
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    Kommentar
                    <input name="comment" defaultValue={response?.comment ?? ''} maxLength={2000} />
                  </label>
                  <button type="submit" className="touch-target">
                    Speichern
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </section>

      {(step.planStep.photoRequired || step.photoEvidence.length > 0) && (
        <section>
          <h2>Fotos ({completedPhotos.length})</h2>
          {step.planStep.photoRequirements.map((requirement) => {
            const matching = completedPhotos.filter(
              (p) =>
                p.photoRequirementId === requirement.id || p.photoCategory === requirement.category,
            );
            return (
              <div key={requirement.id} className="card">
                <p>
                  <strong>{requirement.category}</strong>
                  {requirement.description ? ` — ${requirement.description}` : ''}
                </p>
                <p>
                  {matching.length} von mindestens {requirement.minCount}
                  {requirement.maxCount ? ` (max. ${requirement.maxCount})` : ''} vorhanden
                </p>
                {step.status === 'IN_PROGRESS' && canWork && (
                  <PhotoCaptureWidget
                    workStepInstanceId={step.id}
                    photoRequirementId={requirement.id}
                    label={`Foto „${requirement.category}" aufnehmen`}
                  />
                )}
              </div>
            );
          })}

          {step.planStep.photoRequirements.length === 0 &&
            step.status === 'IN_PROGRESS' &&
            canWork && (
              <div className="card">
                <PhotoCaptureWidget workStepInstanceId={step.id} label="Foto aufnehmen" />
              </div>
            )}

          {step.photoEvidence.length > 0 && (
            <ul>
              {step.photoEvidence.map((photo) => (
                <li key={photo.id}>
                  {photo.photoCategory ?? 'Ohne Kategorie'} —{' '}
                  <StatusChip
                    status={photo.uploadStatus === 'COMPLETED' ? 'COMPLETED' : 'BLOCKED'}
                  />
                  {photo.uploadStatus !== 'COMPLETED' && ` (${photo.uploadStatus})`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step.planStep.inspectionCharacteristics.length > 0 && (
        <section>
          <h2>Messwerte</h2>
          {step.planStep.inspectionCharacteristics.map((characteristic) => {
            const measurement = measurementByCharacteristicId.get(characteristic.id);
            return (
              <div key={characteristic.id} className="card">
                <p>
                  <strong>
                    {characteristic.characteristicNumber}. {characteristic.name}
                  </strong>
                </p>
                <p>
                  Sollwert: {characteristic.nominalValue?.toString() ?? '—'}
                  {characteristic.unit ? ` ${characteristic.unit}` : ''} · Toleranz:{' '}
                  {characteristic.lowerLimit?.toString() ?? '−∞'} –{' '}
                  {characteristic.upperLimit?.toString() ?? '+∞'}
                </p>
                {measurement && (
                  <p>
                    Istwert: {measurement.measuredValue.toString()}
                    {measurement.measuredUnit ? ` ${measurement.measuredUnit}` : ''} —{' '}
                    {measurement.isWithinTolerance ? (
                      <span className="status-chip status-done">✓ in Toleranz</span>
                    ) : (
                      <span className="status-chip status-blocked">⚠ außerhalb Toleranz</span>
                    )}
                  </p>
                )}
                {step.status === 'IN_PROGRESS' && canWork && (
                  <form action={recordMeasurementAction} className="inline-form">
                    <input type="hidden" name="workStepInstanceId" value={step.id} />
                    <input
                      type="hidden"
                      name="inspectionCharacteristicId"
                      value={characteristic.id}
                    />
                    <label>
                      Istwert{characteristic.unit ? ` (${characteristic.unit})` : ''}
                      <input
                        name="measuredValue"
                        inputMode="decimal"
                        required
                        defaultValue={measurement?.measuredValue.toString() ?? ''}
                      />
                    </label>
                    <label>
                      Prüfmittel
                      <input
                        name="measuringEquipmentRef"
                        defaultValue={measurement?.measuringEquipmentRef ?? ''}
                        required={characteristic.requiresMeasuringEquipment}
                      />
                    </label>
                    <button type="submit" className="touch-target">
                      Messwert speichern
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </section>
      )}

      {step.status === 'IN_PROGRESS' && canWork && (
        <>
          <section className="card">
            <h2>Offene Anforderungen ({openCount})</h2>
            {openCount === 0 ? (
              <p>✓ Alle Pflichtangaben sind erfasst.</p>
            ) : (
              <ul>
                {[...step.evaluation.gaps, ...step.evaluation.toleranceViolations].map((gap) => (
                  <li key={`${gap.code}-${gap.affectedField ?? ''}`}>{gap.detail}</li>
                ))}
              </ul>
            )}
          </section>

          <h2>Abschluss</h2>
          <CompleteStepForm
            workStepInstanceId={step.id}
            confirmationText={STEP_CONFIRMATION_TEXT}
            openRequirements={openCount}
          />

          <form action={pauseWorkStepAction}>
            <input type="hidden" name="workStepInstanceId" value={step.id} />
            <button type="submit" className="touch-target">
              Pausieren
            </button>
          </form>
        </>
      )}
    </main>
  );
}

interface RejectionReason {
  code: string;
  detail: string;
  affectedField?: string;
}

function parseReasons(validationReason: string | null): RejectionReason[] {
  if (!validationReason) return [];
  try {
    const parsed: unknown = JSON.parse(validationReason);
    return Array.isArray(parsed) ? (parsed as RejectionReason[]) : [];
  } catch {
    return [];
  }
}
