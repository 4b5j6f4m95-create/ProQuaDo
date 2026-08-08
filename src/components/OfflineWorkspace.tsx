'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOfflineWorkspace } from '@/lib/offline/use-offline-workspace';
import {
  CLIENT_STATUS_LABEL,
  LOCKED_EXPLANATION,
  PENDING_SYNC_EXPLANATION,
  LocalRequirementsNotMetError,
  canStartLocally,
  prepareLocalCompletion,
  startLocally,
  type LocalWorkStep,
} from '@/lib/offline/client-work-step-status';

/**
 * Offline-Arbeitsbereich — the tablet view from docs/07 A1–A7 that keeps
 * working when the hall's WLAN does not.
 *
 * Two things this screen must get right, both from A7:
 *
 *  - A locally finished step says "Lokal abgeschlossen – Serverfreigabe
 *    ausstehend", never "fertig".
 *  - Its successor shows a disabled panel with the reason, never a "Weiter"
 *    button. That is not styling; it is the invariant made visible, and it
 *    holds here because `canStartLocally` requires a release token the
 *    server only issues for steps it has already released.
 */
export function OfflineWorkspace({ actorId }: { actorId: string }) {
  const { state, prepare, sync, enqueue, captureEvidence, capturePhoto, putStep } =
    useOfflineWorkspace(actorId);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [stepError, setStepError] = useState<Record<string, string>>({});

  if (!state.ready) {
    return (
      <main className="tablet">
        <p aria-live="polite">Lokale Ablage wird geöffnet…</p>
      </main>
    );
  }

  const setError = (stepId: string, message: string | null) =>
    setStepError((prev) => {
      const next = { ...prev };
      if (message) next[stepId] = message;
      else delete next[stepId];
      return next;
    });

  const onStart = async (step: LocalWorkStep) => {
    setBusyStep(step.workStepInstanceId);
    try {
      const started = startLocally(step);
      await putStep(started);
      await enqueue(
        'start_work_step',
        {
          workStepInstanceId: step.workStepInstanceId,
          ...(step.releaseToken ? { releaseToken: step.releaseToken } : {}),
        },
        step.entityVersion,
      );
      setError(step.workStepInstanceId, null);
    } catch (error) {
      setError(step.workStepInstanceId, String(error instanceof Error ? error.message : error));
    } finally {
      setBusyStep(null);
    }
  };

  const onComplete = async (step: LocalWorkStep, pin: string) => {
    const reference = state.reference[step.workStepInstanceId];
    const evidence = state.evidence[step.workStepInstanceId] ?? [];
    setBusyStep(step.workStepInstanceId);
    try {
      const answered = evidence
        .filter((e) => e.kind === 'CHECKLIST')
        .map((e) => String(e.data.checklistItemId));
      const measured = evidence
        .filter((e) => e.kind === 'MEASUREMENT')
        .map((e) => String(e.data.inspectionCharacteristicId));
      const photosByRequirement: Record<string, number> = {};
      for (const photo of evidence.filter((e) => e.kind === 'PHOTO')) {
        const key = String(photo.data.photoRequirementId ?? 'any');
        photosByRequirement[key] = (photosByRequirement[key] ?? 0) + 1;
      }

      const completed = prepareLocalCompletion(step, {
        requiredChecklistItemIds:
          reference?.checklistItems.filter((i) => i.isRequired).map((i) => i.id) ?? [],
        answeredChecklistItemIds: answered,
        requiredPhotoCounts:
          reference?.photoRequirements.map((r) => ({
            requirementId: r.id,
            minCount: r.minCount,
          })) ?? [],
        capturedPhotoCountsByRequirement: photosByRequirement,
        requiredCharacteristicIds:
          reference?.inspectionCharacteristics.filter((c) => c.isRequired).map((c) => c.id) ?? [],
        measuredCharacteristicIds: measured,
        // The PIN typed here IS the confirmation; the server verifies it on
        // sync and never stores it.
        hasConfirmation: pin.length >= 4,
      });

      await putStep(completed);
      await enqueue(
        'submit_completion',
        {
          workStepInstanceId: step.workStepInstanceId,
          confirmation: { signatureMethod: 'PIN', pin },
          clientCompletedAt: completed.localCompletedAt,
          // What the device actually had in front of it — the input to the
          // server's revision comparison (Abnahmeszenario C).
          usedDocumentRevisionIds:
            reference?.documentRevisions.map((d) => d.documentRevisionId) ?? [],
        },
        step.entityVersion,
      );
      setError(step.workStepInstanceId, null);
    } catch (error) {
      setError(
        step.workStepInstanceId,
        error instanceof LocalRequirementsNotMetError
          ? error.gaps.map((g) => g.detail).join(' ')
          : String(error instanceof Error ? error.message : error),
      );
    } finally {
      setBusyStep(null);
    }
  };

  return (
    <main className="tablet">
      <h1>Offline-Arbeitsbereich</h1>

      <section className="card" aria-live="polite">
        <p>
          <strong>{state.online ? '🟢 Online' : '🔴 Offline'}</strong>
          {state.pendingMutations > 0 &&
            ` · ${state.pendingMutations} Vorgang/Vorgänge in der Warteschlange`}
        </p>
        {!state.deviceId && (
          <p className="notice">
            Dieses Gerät ist noch nicht registriert. Stellen Sie einmalig eine Verbindung her.
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="touch-target"
            onClick={() => void prepare()}
            disabled={!state.online || !state.deviceId}
          >
            Für Offline vorbereiten
          </button>
          <button
            type="button"
            className="primary touch-target"
            onClick={() => void sync()}
            disabled={!state.online || !state.deviceId}
          >
            Jetzt synchronisieren
          </button>
        </div>
        {state.message && <p className="muted">{state.message}</p>}
        {state.error && (
          <p role="alert" className="error-text">
            {state.error}
          </p>
        )}
      </section>

      {state.steps.length === 0 && (
        <p className="notice">
          Noch keine Arbeitsschritte auf diesem Gerät. Wählen Sie &bdquo;Für Offline
          vorbereiten&ldquo;, solange eine Verbindung besteht.
        </p>
      )}

      {state.steps.map((step) => {
        const reference = state.reference[step.workStepInstanceId];
        const evidence = state.evidence[step.workStepInstanceId] ?? [];
        const error = stepError[step.workStepInstanceId];

        return (
          <section key={step.workStepInstanceId} className="card">
            <h2>
              Schritt {step.stepNumber}: {step.title}
            </h2>
            <p>
              <span className="status-chip">{CLIENT_STATUS_LABEL[step.status]}</span>
            </p>

            {step.status === 'LOCKED' && (
              <p className="notice locked-notice">{LOCKED_EXPLANATION}</p>
            )}

            {step.status === 'COMPLETED_PENDING_SYNC' && (
              <p className="notice">{PENDING_SYNC_EXPLANATION}</p>
            )}

            {step.status === 'BLOCKED_BY_SERVER' && step.conflictId && (
              <p className="notice">
                ⚠ Ein Konflikt wartet auf Entscheidung.{' '}
                <Link href={`/sync/conflicts/${step.conflictId}`}>Details anzeigen</Link>
              </p>
            )}

            {step.status === 'SERVER_CONFIRMED_REJECTED' && step.rejectionReasons && (
              <ul>
                {step.rejectionReasons.map((reason) => (
                  <li key={reason.code}>{reason.detail}</li>
                ))}
              </ul>
            )}

            {step.status === 'READY' && !step.releaseToken && (
              <p className="notice locked-notice">
                Freigabe liegt vor, das Freigabe-Token ist aber noch nicht auf diesem Gerät.
                Synchronisieren Sie, solange eine Verbindung besteht.
              </p>
            )}

            {canStartLocally(step) && (
              <button
                type="button"
                className="primary touch-target"
                onClick={() => void onStart(step)}
                disabled={busyStep === step.workStepInstanceId}
              >
                Arbeitsschritt starten
              </button>
            )}

            {step.status === 'IN_PROGRESS' && reference && (
              <StepCapture
                step={step}
                reference={reference}
                evidenceCount={evidence.length}
                busy={busyStep === step.workStepInstanceId}
                onChecklist={(checklistItemId, response) =>
                  void (async () => {
                    await captureEvidence({
                      workStepInstanceId: step.workStepInstanceId,
                      kind: 'CHECKLIST',
                      data: { checklistItemId, response },
                    });
                    await enqueue(
                      'record_checklist_response',
                      {
                        workStepInstanceId: step.workStepInstanceId,
                        checklistItemId,
                        response,
                      },
                      step.entityVersion,
                    );
                  })()
                }
                onMeasurement={(inspectionCharacteristicId, measuredValue) =>
                  void (async () => {
                    await captureEvidence({
                      workStepInstanceId: step.workStepInstanceId,
                      kind: 'MEASUREMENT',
                      data: { inspectionCharacteristicId, measuredValue },
                    });
                    await enqueue(
                      'record_measurement_result',
                      {
                        workStepInstanceId: step.workStepInstanceId,
                        inspectionCharacteristicId,
                        measuredValue,
                      },
                      step.entityVersion,
                    );
                  })()
                }
                onPhoto={(file, requirementId) =>
                  void capturePhoto(step.workStepInstanceId, file, requirementId)
                }
                onComplete={(pin) => void onComplete(step, pin)}
              />
            )}

            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </section>
        );
      })}
    </main>
  );
}

interface StepReference {
  instruction: string | null;
  checklistItems: Array<{ id: string; itemNumber: number; text: string; isRequired: boolean }>;
  photoRequirements: Array<{ id: string; category: string; minCount: number }>;
  inspectionCharacteristics: Array<{
    id: string;
    characteristicNumber: number;
    name: string;
    unit: string | null;
    isRequired: boolean;
  }>;
  documentRevisions: Array<{
    documentRevisionId: string;
    documentNumber: string;
    revisionNumber: string;
  }>;
}

function StepCapture({
  reference,
  evidenceCount,
  busy,
  onChecklist,
  onMeasurement,
  onPhoto,
  onComplete,
}: {
  step: LocalWorkStep;
  reference: StepReference;
  evidenceCount: number;
  busy: boolean;
  onChecklist: (checklistItemId: string, response: string) => void;
  onMeasurement: (inspectionCharacteristicId: string, measuredValue: string) => void;
  onPhoto: (file: File, requirementId?: string) => void;
  onComplete: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');

  return (
    <>
      {reference.instruction && <p>{reference.instruction}</p>}

      {reference.documentRevisions.length > 0 && (
        <p className="muted">
          Verbindliche Unterlagen:{' '}
          {reference.documentRevisions
            .map((d) => `${d.documentNumber} Rev. ${d.revisionNumber}`)
            .join(', ')}
        </p>
      )}

      {reference.checklistItems.map((item) => (
        <div key={item.id} className="checklist-row">
          <p>
            <strong>
              {item.itemNumber}. {item.text}
            </strong>
          </p>
          <div className="actions">
            {['OK', 'NOK', 'N/A'].map((response) => (
              <button
                key={response}
                type="button"
                className="touch-target"
                onClick={() => onChecklist(item.id, response)}
              >
                {response}
              </button>
            ))}
          </div>
        </div>
      ))}

      {reference.inspectionCharacteristics.map((characteristic) => (
        <label key={characteristic.id}>
          {characteristic.characteristicNumber}. {characteristic.name}
          {characteristic.unit ? ` (${characteristic.unit})` : ''}
          <input
            inputMode="decimal"
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value) onMeasurement(characteristic.id, value);
            }}
          />
        </label>
      ))}
      {reference.inspectionCharacteristics.length > 0 && (
        <p className="muted">
          Die Toleranzprüfung erfolgt serverseitig bei der Synchronisation — dieses Gerät bewertet
          keinen Messwert.
        </p>
      )}

      {reference.photoRequirements.map((requirement) => (
        <label key={requirement.id}>
          Foto &bdquo;{requirement.category}&ldquo; (mindestens {requirement.minCount})
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onPhoto(file, requirement.id);
            }}
          />
        </label>
      ))}

      <p className="muted">{evidenceCount} Erfassung(en) lokal gespeichert.</p>

      <label>
        Bestätigungs-PIN
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(event) => setPin(event.currentTarget.value)}
          minLength={4}
          maxLength={12}
        />
      </label>
      <button
        type="button"
        className="primary touch-target"
        disabled={busy || pin.length < 4}
        onClick={() => onComplete(pin)}
      >
        Lokal abschließen
      </button>
      <p className="muted">
        Der Abschluss wird lokal vermerkt und erst nach serverseitiger Prüfung endgültig. Der
        Folgeschritt bleibt bis dahin gesperrt.
      </p>
    </>
  );
}
