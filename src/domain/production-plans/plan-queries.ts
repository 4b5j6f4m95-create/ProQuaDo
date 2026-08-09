import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { hasPermissionWithin } from '@/lib/authz/permission-within';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export async function getProductionPlanRevision(actor: Actor, revisionId: string) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const revision = await tx.productionPlanRevision.findFirst({
      where: { id: revisionId },
      include: {
        // The plan's project, so the editor can offer the documents that
        // belong to it rather than everything in the organization.
        productionPlan: { select: { id: true, projectId: true, name: true } },
        steps: {
          orderBy: { stepNumber: 'asc' },
          include: {
            predecessorLinks: true,
            successorLinks: true,
            checklistItems: { orderBy: { itemNumber: 'asc' } },
            photoRequirements: { orderBy: { category: 'asc' } },
            inspectionCharacteristics: { orderBy: { characteristicNumber: 'asc' } },
            documentBindings: {
              orderBy: { createdAt: 'asc' },
              include: {
                documentRevision: {
                  select: {
                    id: true,
                    revisionNumber: true,
                    title: true,
                    status: true,
                    document: { select: { documentNumber: true, category: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!revision) throw new NotFoundError('Fertigungsplan-Revision');
    return revision;
  });
}

/**
 * The released document revisions a plan step may be bound to — the choices
 * the planning screen offers.
 *
 * Only RELEASED, because that is the only status `bindDocumentToPlanStep`
 * accepts (Geschäftsgrundsatz 6: binding is to a released revision, never to
 * a draft and never to "the newest"). Offering anything else would be a menu
 * of items the server refuses.
 *
 * Confined to the plan's own project: a document belonging to a different
 * project has no business being binding for this one, and listing it would
 * widen what a planner can see for no purpose.
 *
 * Returns an empty list rather than throwing when the actor may not view
 * documents. The planner then sees "no bindable documents" instead of a
 * broken page — and, importantly, the count of what they cannot see is not
 * disclosed either (same rule as the search, see search.ts).
 */
export async function listBindableDocumentRevisions(actor: Actor, projectId: string) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    if (!(await hasPermissionWithin(tx, actor, 'document.view'))) return [];

    return tx.documentRevision.findMany({
      where: { status: 'RELEASED', document: { projectId } },
      orderBy: [{ document: { documentNumber: 'asc' } }, { revisionNumber: 'asc' }],
      select: {
        id: true,
        revisionNumber: true,
        title: true,
        document: { select: { documentNumber: true, category: true } },
      },
    });
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
