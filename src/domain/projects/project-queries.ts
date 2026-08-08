import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export async function getProject(actor: Actor, projectId: string) {
  await assertPermission(actor, 'project.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId },
      include: { customer: true, site: true, members: true },
    });
    if (!project) throw new NotFoundError('Projekt');
    return project;
  });
}

export async function listProjects(actor: Actor, filter?: { status?: string }) {
  await assertPermission(actor, 'project.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.project.findMany({
      where: filter?.status ? { status: filter.status } : undefined,
      include: { customer: true, site: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
}
