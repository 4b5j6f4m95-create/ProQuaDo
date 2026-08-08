'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProductionPlan } from '@/domain/production-plans/create-production-plan';
import { addPlanStep, addPlanStepDependency } from '@/domain/production-plans/plan-steps';
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
