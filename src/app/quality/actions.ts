'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { raiseNonConformance } from '@/domain/quality/raise-non-conformance';
import {
  assessNonConformance,
  containNonConformance,
  createReinspectionStep,
  createReworkStep,
  disposeNonConformance,
} from '@/domain/quality/ncr-workflow';
import { releaseProductionHold } from '@/domain/quality/production-holds';
import { decideSecondApproval } from '@/domain/quality/second-approval';
import { createMeasuringEquipment, recordCalibration } from '@/domain/quality/measuring-equipment';
import type { DispositionType } from '@/domain/quality/ncr-status';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export async function raiseNonConformanceAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  const ncr = await raiseNonConformance({
    actor,
    productionOrderId: String(formData.get('productionOrderId')),
    workStepInstanceId: workStepInstanceId || undefined,
    description: String(formData.get('description')),
    errorCategory: (formData.get('errorCategory') as string) || undefined,
    priority: (formData.get('priority') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') || 'MEDIUM',
    reporterSuggestsBlocking: formData.get('reporterSuggestsBlocking') === 'on',
  });
  redirect(`/quality/ncrs/${ncr.id}`);
}

export async function assessNonConformanceAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const nonConformanceId = String(formData.get('nonConformanceId'));
  const blockingChoice = String(formData.get('isBlocking'));
  await assessNonConformance({
    actor,
    nonConformanceId,
    assessmentNotes: String(formData.get('assessmentNotes')),
    isBlocking: blockingChoice === 'unchanged' ? undefined : blockingChoice === 'true',
    priority: (formData.get('priority') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') || undefined,
  });
  revalidatePath(`/quality/ncrs/${nonConformanceId}`);
}

export async function containNonConformanceAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const nonConformanceId = String(formData.get('nonConformanceId'));
  await containNonConformance({
    actor,
    nonConformanceId,
    immediateAction: String(formData.get('immediateAction')),
    rootCause: (formData.get('rootCause') as string) || undefined,
  });
  revalidatePath(`/quality/ncrs/${nonConformanceId}`);
}

export async function createReworkStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const nonConformanceId = String(formData.get('nonConformanceId'));
  await createReworkStep({ actor, nonConformanceId });
  revalidatePath(`/quality/ncrs/${nonConformanceId}`);
}

export async function createReinspectionStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const nonConformanceId = String(formData.get('nonConformanceId'));
  await createReinspectionStep({ actor, nonConformanceId });
  revalidatePath(`/quality/ncrs/${nonConformanceId}`);
}

export async function disposeNonConformanceAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const nonConformanceId = String(formData.get('nonConformanceId'));
  await disposeNonConformance({
    actor,
    nonConformanceId,
    dispositionType: String(formData.get('dispositionType')) as DispositionType,
    dispositionReason: String(formData.get('dispositionReason')),
  });
  revalidatePath(`/quality/ncrs/${nonConformanceId}`);
}

export async function releaseProductionHoldAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const nonConformanceId = String(formData.get('nonConformanceId'));
  await releaseProductionHold({
    actor,
    productionHoldId: String(formData.get('productionHoldId')),
    releaseReason: String(formData.get('releaseReason')),
  });
  revalidatePath(`/quality/ncrs/${nonConformanceId}`);
}

export interface SecondApprovalFormState {
  error: string | null;
}

/**
 * Four-eyes decision (docs/07, Abnahmeszenario E). Returns its error rather
 * than throwing so "Sie dürfen Ihre eigene Ausführung nicht prüfen" appears
 * next to the form instead of on an error page.
 */
export async function decideSecondApprovalAction(
  _prevState: SecondApprovalFormState,
  formData: FormData,
): Promise<SecondApprovalFormState> {
  const workStepInstanceId = String(formData.get('workStepInstanceId'));
  try {
    const actor = await requireAuthContext();
    await decideSecondApproval({
      actor,
      workStepInstanceId,
      decision: String(formData.get('decision')) as 'APPROVE' | 'REJECT',
      reason: (formData.get('reason') as string) || undefined,
      pin: String(formData.get('pin')),
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

export async function createMeasuringEquipmentAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  await createMeasuringEquipment({
    actor,
    equipmentNumber: String(formData.get('equipmentNumber')),
    name: String(formData.get('name')),
    manufacturer: (formData.get('manufacturer') as string) || undefined,
    measurementUnit: (formData.get('measurementUnit') as string) || undefined,
    location: (formData.get('location') as string) || undefined,
  });
  revalidatePath('/quality/equipment');
}

export async function recordCalibrationAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  await recordCalibration({
    actor,
    measuringEquipmentId: String(formData.get('measuringEquipmentId')),
    calibratedAt: new Date(String(formData.get('calibratedAt'))),
    nextCalibrationDueAt: new Date(String(formData.get('nextCalibrationDueAt'))),
    calibratedBy: (formData.get('calibratedBy') as string) || undefined,
  });
  revalidatePath('/quality/equipment');
}
