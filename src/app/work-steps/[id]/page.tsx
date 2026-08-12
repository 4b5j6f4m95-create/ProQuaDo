import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getWorkStepInstance, listWorkStepsOfOrder } from '@/domain/execution/execution-queries';
import { STEP_CONFIRMATION_TEXT } from '@/domain/execution/complete-work-step';
import {
  openRequirementCount,
  requirementsBlockingCompletion,
} from '@/domain/execution/step-requirements';
import { listMeasuringEquipment } from '@/domain/quality/measuring-equipment';
import { IfcComponentList } from './IfcComponentList';
import { StatusChip } from '@/components/StatusChip';
import { CompleteStepForm } from '@/components/CompleteStepForm';
import { PhotoCaptureWidget } from '@/components/PhotoCaptureWidget';
import { SecondApprovalForm } from '@/components/SecondApprovalForm';
import {
  pauseWorkStepAction,
  recordChecklistResponseAction,
  recordMeasurementAction,
  reopenRejectedStepAction,
  resumeWorkStepAction,
  startWorkStepAction,
} from '../actions';
import { raiseNonConformanceAction } from '@/app/quality/actions';

const RESPONSE_OPTIONS = ['OK', 'NOK', 'N/A'] as const;

const STEP_KIND_LABEL: Record<string, string> = {
  PRODUCTION: '',
  REWORK: '🔁 Nacharbeit',
  REINSPECTION: '🔍 Nachprüfung',
};

/** Arbeitsschritt-Ansicht — docs/07_WIREFLOWS_UX.md A2–A6 und A9. */
export default async function WorkStepPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const step = await getWorkStepInstance(actor, params.id);
  const siblings = await listWorkStepsOfOrder(actor, step.productionOrderId);
  // Only equipment that is usable right now is offered — the same verdict
  // the capture gate applies (Negativtest #11).
  const equipment = step.planStep.inspectionCharacteristics.length
    ? await listMeasuringEquipment(actor)
    : [];
  const usableEquipment = equipment.filter((item) => item.isUsable);

  const openCount = openRequirementCount(step.evaluation);
  // What the list shows and what disables the button are different questions:
  // the confirmation is supplied by the form itself, and an out-of-tolerance
  // value has to reach the server so it can raise the NCR. See
  // requirementsBlockingCompletion.
  const blockingCount = requirementsBlockingCompletion(step.evaluation).length;
  const canWork = step.isAssignedToOrder;
  const responseByItemId = new Map(step.checklistResponses.map((r) => [r.checklistItemId, r]));
  const measurementByCharacteristicId = new Map(
    step.measurementResults.map((m) => [m.inspectionCharacteristicId, m]),
  );
  const completedPhotos = step.photoEvidence.filter((p) => p.uploadStatus === 'COMPLETED');
  const rejectionReasons = parseReasons(step.latestSubmission?.validationReason ?? null);
  const nextStep = siblings.find((s) => s.stepNumber > step.stepNumber);
  const openNcrs = step.raisedNonConformances.filter(
    (ncr) => ncr.status !== 'CLOSED' && ncr.status !== 'CANCELLED',
  );
  const openConflicts = step.openConflicts;
  const awaitsMyReview =
    step.status === 'AWAITING_SECOND_APPROVAL' &&
    step.secondApproval !== null &&
    step.secondApproval.executorId !== actor.userId;

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
        {step.stepKind !== 'PRODUCTION' && (
          <span className="status-chip">{STEP_KIND_LABEL[step.stepKind]}</span>
        )}
        {step.planStep.fourEyesRequired && (
          <span className="status-chip">👥 Vier-Augen-Pflicht</span>
        )}
      </p>

      {step.originWorkStepInstance && (
        <p className="muted">
          {step.stepKind === 'REWORK' ? 'Nacharbeit' : 'Nachprüfung'} zu{' '}
          <Link href={`/work-steps/${step.originWorkStepInstance.id}`}>
            Schritt {step.originWorkStepInstance.stepNumber} (Erstausführung)
          </Link>
          {step.nonConformance && (
            <>
              {' · '}
              <Link href={`/quality/ncrs/${step.nonConformance.id}`}>
                {step.nonConformance.ncrNumber}
              </Link>
            </>
          )}
        </p>
      )}

      {openConflicts.length > 0 && (
        // docs/07 A8. The worker is told what happened and that it is being
        // decided — not offered a way to decide it themselves, and not told
        // to try again.
        <section className="card blocked-card">
          <h2>⚠ Konflikt erkannt</h2>
          {openConflicts.map((conflict) => (
            <p key={conflict.id}>
              {conflict.summary}
              <br />
              Ihre Ausführung bleibt mit der verwendeten Revision dokumentiert. Eine verantwortliche
              Person muss entscheiden, wie fortgefahren wird.
              <br />
              <Link href={`/sync/conflicts/${conflict.id}`}>Details anzeigen</Link>
            </p>
          ))}
        </section>
      )}

      {(step.activeHolds.length > 0 || openNcrs.length > 0) && (
        <section className="card blocked-card">
          <h2>⛔ Qualitätssperre</h2>
          {step.activeHolds.map((hold) => (
            <p key={hold.id}>
              {hold.holdReason}
              {hold.releaseCondition && (
                <>
                  <br />
                  <strong>Nächste Handlung:</strong> {hold.releaseCondition}
                </>
              )}
            </p>
          ))}
          {openNcrs.length > 0 && (
            <ul>
              {openNcrs.map((ncr) => (
                <li key={ncr.id}>
                  <Link href={`/quality/ncrs/${ncr.id}`}>{ncr.ncrNumber}</Link> —{' '}
                  {ncr.isBlocking ? 'blockierend' : 'nicht blockierend'} · {ncr.status}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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

      {/* Im Modell benannt, im System nicht vorhanden. Das gehört vor die
          Augen des Werkers und nicht nur in ein Import-Protokoll: er soll
          erfahren, dass es zu diesem Schritt eine Zeichnung geben müsste,
          bevor er ohne sie anfängt. */}
      {step.planStep.ifcDrawingReferences.length > 0 && (
        <section className="card">
          <h2>Im Modell genannte Zeichnungen ({step.planStep.ifcDrawingReferences.length})</h2>
          <p className="notice">
            Diese Zeichnungen nennt das Gebäudemodell für diesen Schritt. Sie liegen nicht als
            freigegebenes Dokument im System und lassen sich hier deshalb nicht öffnen.
          </p>
          <ul>
            {step.planStep.ifcDrawingReferences.map((reference) => (
              <li key={reference.id}>
                {reference.identification ? <strong>{reference.identification}</strong> : null}
                {reference.identification && reference.name ? ' — ' : ''}
                {reference.name}
                {reference.location ? <span className="muted"> · {reference.location}</span> : null}
                {reference.description ? (
                  <div className="muted">{reference.description}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <IfcComponentList components={step.planStep.ifcComponents} />

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
        <>
          <p className="notice">
            👥 Ausführung bestätigt. Der Schritt gilt erst als abgeschlossen, wenn eine zweite,
            unabhängige Person die Prüfung bestätigt hat.
          </p>
          {awaitsMyReview ? (
            <SecondApprovalForm
              workStepInstanceId={step.id}
              executorLabel={
                step.latestSubmission?.submittedById === step.secondApproval?.executorId
                  ? 'ausführende Person dieses Schritts'
                  : 'ausführende Person'
              }
            />
          ) : (
            <p className="muted">
              Sie haben diesen Schritt ausgeführt und können die unabhängige Prüfung deshalb nicht
              selbst bestätigen.
            </p>
          )}
        </>
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
                    {measurement.measuredUnit ? ` ${measurement.measuredUnit}` : ''}
                    {measurement.measuringEquipment
                      ? ` · Prüfmittel ${measurement.measuringEquipment.equipmentNumber}`
                      : ''}{' '}
                    —{' '}
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
                      <select
                        name="measuringEquipmentId"
                        defaultValue={measurement?.measuringEquipment?.id ?? ''}
                        required={characteristic.requiresMeasuringEquipment}
                      >
                        <option value="">— kein Prüfmittel —</option>
                        {usableEquipment.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.equipmentNumber} · {item.name}
                            {item.nextCalibrationDueAt
                              ? ` (kalibriert bis ${item.nextCalibrationDueAt.toLocaleDateString('de-DE')})`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {equipment.length > usableEquipment.length && (
                      <p className="muted">
                        Gesperrte oder überfällige Prüfmittel werden nicht angeboten.
                      </p>
                    )}
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
            openRequirements={blockingCount}
            usedDocumentRevisionIds={step.planStep.documentBindings.map(
              (binding) => binding.documentRevision.id,
            )}
          />

          <form action={pauseWorkStepAction}>
            <input type="hidden" name="workStepInstanceId" value={step.id} />
            <button type="submit" className="touch-target">
              Pausieren
            </button>
          </form>
        </>
      )}

      {canWork && (
        // Abweichung melden (docs/07 A9). Available in any state a worker
        // can see: a deviation noticed after the fact is still a deviation.
        <details className="card">
          <summary className="touch-target">Abweichung melden</summary>
          <form action={raiseNonConformanceAction}>
            <input type="hidden" name="productionOrderId" value={step.productionOrderId} />
            <input type="hidden" name="workStepInstanceId" value={step.id} />
            <label>
              Fehlerart
              <select name="errorCategory">
                <option value="MASSABWEICHUNG">Maßabweichung</option>
                <option value="MASSABWEICHUNG_KRITISCH">Maßabweichung (kritisch)</option>
                <option value="MATERIALFEHLER">Materialfehler</option>
                <option value="FUNKTIONSFEHLER">Funktionsfehler</option>
                <option value="OBERFLAECHE">Oberflächenfehler</option>
                <option value="SONSTIGES">Sonstiges</option>
              </select>
            </label>
            <label>
              Beschreibung
              <textarea name="description" rows={3} required maxLength={4000} />
            </label>
            <label>
              Schweregrad
              <select name="priority" defaultValue="MEDIUM">
                <option value="CRITICAL">Kritisch</option>
                <option value="HIGH">Hoch</option>
                <option value="MEDIUM">Mittel</option>
                <option value="LOW">Gering</option>
              </select>
            </label>
            <label className="radio-option">
              <input type="checkbox" name="reporterSuggestsBlocking" /> Produktion sofort sperren
            </label>
            <p className="muted">
              Die endgültige Einstufung als blockierend trifft der Server anhand von Fehlerart und
              Schweregrad — eine Meldung kann sie verschärfen, aber nicht abschwächen.
            </p>
            <button type="submit" className="touch-target">
              Abweichung melden
            </button>
          </form>
        </details>
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
