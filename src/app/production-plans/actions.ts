'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { AuthzError } from '@/lib/authz/errors';
import { DomainError } from '@/lib/domain-errors';
import { createProductionPlan } from '@/domain/production-plans/create-production-plan';
import { addPlanStep, addPlanStepDependency } from '@/domain/production-plans/plan-steps';
import {
  addChecklistItem,
  addInspectionCharacteristic,
  addPhotoRequirement,
  bindDocumentToPlanStep,
  unbindDocumentFromPlanStep,
} from '@/domain/production-plans/plan-step-requirements';
import {
  submitProductionPlanForReview,
  approveProductionPlan,
  rejectProductionPlan,
  releaseProductionPlan,
} from '@/domain/production-plans/plan-review-workflow';

export async function createProductionPlanAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const { revision } = await createProductionPlan({
    actor,
    projectId: String(formData.get('projectId')),
    productId: String(formData.get('productId')),
    planNumber: String(formData.get('planNumber')),
    name: String(formData.get('name')),
  });
  redirect(`/production-plans/${revision.id}`);
}

export async function addPlanStepAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await addPlanStep({
    actor,
    productionPlanRevisionId,
    stepNumber: Number(formData.get('stepNumber')),
    title: String(formData.get('title')),
    photoRequired: formData.get('photoRequired') === 'on',
    fourEyesRequired: formData.get('fourEyesRequired') === 'on',
  });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function addPlanStepDependencyAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await addPlanStepDependency({
    actor,
    productionPlanRevisionId,
    predecessorStepId: String(formData.get('predecessorStepId')),
    dependentStepId: String(formData.get('dependentStepId')),
  });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function addChecklistItemAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await addChecklistItem({
    actor,
    productionPlanRevisionId,
    planStepId: String(formData.get('planStepId')),
    itemNumber: Number(formData.get('itemNumber')),
    text: String(formData.get('text')),
  });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function addPhotoRequirementAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  const maxCount = Number(formData.get('maxCount'));
  await addPhotoRequirement({
    actor,
    productionPlanRevisionId,
    planStepId: String(formData.get('planStepId')),
    category: String(formData.get('category')),
    minCount: Number(formData.get('minCount')) || 1,
    maxCount: maxCount > 0 ? maxCount : undefined,
  });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function addInspectionCharacteristicAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await addInspectionCharacteristic({
    actor,
    productionPlanRevisionId,
    planStepId: String(formData.get('planStepId')),
    characteristicNumber: Number(formData.get('characteristicNumber')),
    name: String(formData.get('name')),
    nominalValue: (formData.get('nominalValue') as string) || undefined,
    lowerLimit: (formData.get('lowerLimit') as string) || undefined,
    upperLimit: (formData.get('upperLimit') as string) || undefined,
    unit: (formData.get('unit') as string) || undefined,
  });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export interface BindingFormState {
  error: string | null;
}

/**
 * Binds a released document revision to a plan step — docs/10 Phase 2
 * "Schritt-Dokumentbindung", and the last piece Abnahmeszenario C needed to
 * be reachable from the interface rather than only from a test.
 *
 * `pageNumber` and `markerLabel` are optional in the model and stay optional
 * here: a binding without a page still says which drawing is binding, which
 * is the part production correctness depends on.
 *
 * Returns the error instead of throwing. The first version threw, like the
 * other plan-editing actions — and binding the same revision twice, which a
 * double click produces, then replaced the whole planning screen with the
 * error boundary. "Revision 01 ist bereits verknüpft" is a normal answer with
 * an obvious next action, not a page-destroying event. Same treatment the
 * export and the four-eyes decision already get.
 */
export async function bindDocumentToStepAction(
  _prevState: BindingFormState,
  formData: FormData,
): Promise<BindingFormState> {
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  const pageNumber = Number(formData.get('pageNumber'));
  const markerLabel = String(formData.get('markerLabel') ?? '').trim();

  try {
    const actor = await requireAuthContext();
    await bindDocumentToPlanStep({
      actor,
      productionPlanRevisionId,
      planStepId: String(formData.get('planStepId')),
      documentRevisionId: String(formData.get('documentRevisionId')),
      pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
      markerLabel: markerLabel || undefined,
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
  return { error: null };
}

/** Same reasoning as above: a removal refused because the plan has meanwhile
 *  left DRAFT is an answer, not a crash. */
export async function unbindDocumentFromStepAction(
  _prevState: BindingFormState,
  formData: FormData,
): Promise<BindingFormState> {
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));

  try {
    const actor = await requireAuthContext();
    await unbindDocumentFromPlanStep({
      actor,
      productionPlanRevisionId,
      planStepId: String(formData.get('planStepId')),
      bindingId: String(formData.get('bindingId')),
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
  return { error: null };
}

export async function submitPlanForReviewAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await submitProductionPlanForReview({ actor, productionPlanRevisionId });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function approvePlanAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await approveProductionPlan({ actor, productionPlanRevisionId });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function rejectPlanAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await rejectProductionPlan({
    actor,
    productionPlanRevisionId,
    reason: 'Überarbeitung erforderlich',
  });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}

export async function releasePlanAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionPlanRevisionId = String(formData.get('productionPlanRevisionId'));
  await releaseProductionPlan({ actor, productionPlanRevisionId });
  revalidatePath(`/production-plans/${productionPlanRevisionId}`);
}
