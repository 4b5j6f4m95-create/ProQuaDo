'use server';

import { redirect } from 'next/navigation';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProject } from '@/domain/projects/create-project';
import { transitionProjectStatus } from '@/domain/projects/update-project';
import type { ProjectStatus } from '@/domain/projects/project-status';

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
