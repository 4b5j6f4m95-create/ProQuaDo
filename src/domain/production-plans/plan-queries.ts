import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export async function getProductionPlanRevision(actor: Actor, revisionId: string) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const revision = await tx.productionPlanRevision.findFirst({
      where: { id: revisionId },
      include: {
        steps: {
          orderBy: { stepNumber: 'asc' },
          include: { predecessorLinks: true, successorLinks: true, checklistItems: true },
        },
      },
    });
    if (!revision) throw new NotFoundError('Fertigungsplan-Revision');
    return revision;
  });
}

export async function listProductionPlans(actor: Actor, filter?: { projectId?: string }) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.productionPlan.findMany({
      where: filter?.projectId ? { projectId: filter.projectId } : undefined,
      include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    }),
  );
}
