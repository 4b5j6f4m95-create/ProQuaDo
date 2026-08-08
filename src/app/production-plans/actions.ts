'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProductionPlan } from '@/domain/production-plans/create-production-plan';
import { addPlanStep, addPlanStepDependency } from '@/domain/production-plans/plan-steps';
import {
  addChecklistItem,
  addInspectionCharacteristic,
  addPhotoRequirement,
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
