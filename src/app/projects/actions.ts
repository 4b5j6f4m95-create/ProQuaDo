'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProject } from '@/domain/projects/create-project';
import { createProduct } from '@/domain/master-data/master-data';
import { transitionProjectStatus } from '@/domain/projects/update-project';
import type { ProjectStatus } from '@/domain/projects/project-status';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export async function createProjectAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const project = await createProject({
    actor,
    siteId: String(formData.get('siteId')),
    projectNumber: String(formData.get('projectNumber')),
    name: String(formData.get('name')),
    customerId: String(formData.get('customerId')),
    description: formData.get('description') ? String(formData.get('description')) : undefined,
  });
  redirect(`/projects/${project.id}`);
}

export interface ProductFormState {
  error: string | null;
  result: string | null;
}

/**
 * Produkt im Projekt anlegen.
 *
 * Es steht hier und nicht in der Administration, weil es am Projekt hängt
 * (`products.project_id`) und `product.manage` bei der Projektleitung liegt —
 * dort, wo ohnehin geplant wird.
 */
export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const actor = await requireAuthContext();
    const product = await createProduct({
      actor,
      projectId,
      productNumber: String(formData.get('productNumber') ?? ''),
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || undefined,
    });
    revalidatePath(`/projects/${projectId}`);
    return { error: null, result: `Produkt ${product.productNumber} angelegt.` };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message, result: null };
    }
    throw error;
  }
}

export async function transitionProjectStatusAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const projectId = String(formData.get('projectId'));
  await transitionProjectStatus({
    actor,
    projectId,
    toStatus: String(formData.get('toStatus')) as ProjectStatus,
    expectedVersion: Number(formData.get('expectedVersion')),
  });
  redirect(`/projects/${projectId}`);
}
