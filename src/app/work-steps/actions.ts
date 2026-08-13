'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  pauseWorkStep,
  resumeWorkStep,
  reworkRejectedCompletion,
  startWorkStep,
} from '@/domain/execution/start-work-step';
import {
  recordChecklistResponse,
  recordMeasurementResult,
  type ChecklistResponseValue,
} from '@/domain/execution/capture-evidence';
import { submitWorkStepCompletion } from '@/domain/execution/complete-work-step';
import {
  addWorkStepSupplement,
  removeWorkStepSupplement,
} from '@/domain/execution/work-step-supplements';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export async function startWorkStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await startWorkStep({ actor, workStepInstanceId });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export async function pauseWorkStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await pauseWorkStep({ actor, workStepInstanceId });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export async function resumeWorkStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await resumeWorkStep({ actor, workStepInstanceId });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export async function reopenRejectedStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await reworkRejectedCompletion({ actor, workStepInstanceId });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export async function recordChecklistResponseAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await recordChecklistResponse({
    actor,
    workStepInstanceId,
    checklistItemId: String(formData.get('checklistItemId')),
    response: String(formData.get('response')) as ChecklistResponseValue,
    comment: (formData.get('comment') as string) || undefined,
  });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export async function recordMeasurementAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await recordMeasurementResult({
    actor,
    workStepInstanceId,
    inspectionCharacteristicId: String(formData.get('inspectionCharacteristicId')),
    measuredValue: String(formData.get('measuredValue')),
    measuringEquipmentRef: (formData.get('measuringEquipmentRef') as string) || undefined,
  });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export interface CompleteStepFormState {
  error: string | null;
}

/**
 * The confirmation step (docs/07 A5). Returns its error instead of throwing
 * so the tablet can show "PIN falsch" inline next to the field — a worker
 * mistyping a PIN must not land on an error page mid-shift.
 *
 * A rejected completion is NOT an error here: the server persisted the
 * rejection and its reasons, and the page renders them after revalidation.
 */
export async function completeWorkStepAction(
  _prevState: CompleteStepFormState,
  formData: FormData,
): Promise<CompleteStepFormState> {
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  try {
    const actor = await requireAuthContext();
    await submitWorkStepCompletion({
      actor,
      workStepInstanceId,
      // One key per confirmation attempt. A browser resubmit (double tap,
      // back-and-forward) produces a new key and is caught by the step's
      // status check instead; the key's job is to make an interrupted
      // request safe to retry, which is Phase 5's sync path.
      idempotencyKey: randomUUID(),
      confirmation: {
        signatureMethod: 'PIN',
        pin: String(formData.get('pin')),
      },
      // Which document revisions were on screen while the step was worked
      // on. The online client can state this too, and should: the revision
      // comparison at validation is not an offline-only concern — a page
      // left open across a release is stale in exactly the same way
      // (Abnahmeszenario C).
      usedDocumentRevisionIds: formData
        .getAll('usedDocumentRevisionIds')
        .map(String)
        .filter(Boolean),
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/work-steps/${workStepInstanceId}`);
  return { error: null };
}

export async function addWorkStepSupplementAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await addWorkStepSupplement({
    actor,
    workStepInstanceId,
    documentRevisionId: String(formData.get('documentRevisionId')),
    reason: String(formData.get('reason') ?? ''),
  });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}

export async function removeWorkStepSupplementAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  await removeWorkStepSupplement({
    actor,
    supplementId: String(formData.get('supplementId')),
    reason: String(formData.get('reason') ?? ''),
  });
  revalidatePath(`/work-steps/${workStepInstanceId}`);
}
