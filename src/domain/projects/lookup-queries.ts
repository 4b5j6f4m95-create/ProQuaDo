import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import type { Actor } from '@/domain/shared/actor';

// Small auxiliary lookups for populating form dropdowns (site/customer/
// product pickers) — deliberately not full "domain services" since they
// carry no state-machine or invariant logic, just RLS-scoped reads.

export async function listSites(actor: Actor) {
  await assertPermission(actor, 'project.view');
  return withOrgContext(actor.organizationId, (tx) =>
    tx.site.findMany({ orderBy: { name: 'asc' } }),
  );
}

export async function listCustomers(actor: Actor) {
  await assertPermission(actor, 'project.view');
  return withOrgContext(actor.organizationId, (tx) =>
    tx.customer.findMany({ orderBy: { name: 'asc' } }),
  );
}

export async function listProductsForProject(actor: Actor, projectId: string) {
  await assertPermission(actor, 'project.view');
  return withOrgContext(actor.organizationId, (tx) =>
    tx.product.findMany({ where: { projectId }, orderBy: { name: 'asc' } }),
  );
}

/** Released plan revisions of a product — the only ones a production order
 *  may be created against (see createProductionOrder). */
export async function listReleasedPlanRevisionsForProduct(actor: Actor, productId: string) {
  await assertPermission(actor, 'production_order.view');
  return withOrgContext(actor.organizationId, (tx) =>
    tx.productionPlanRevision.findMany({
      where: { status: 'RELEASED', productionPlan: { productId } },
      include: { productionPlan: { select: { planNumber: true, name: true, productId: true } } },
      orderBy: { releasedAt: 'desc' },
    }),
  );
}

/** Released plan revisions across all products of a project — what the
 *  "neuer Produktionsauftrag" form offers. */
export async function listReleasedPlanRevisionsForProject(actor: Actor, projectId: string) {
  await assertPermission(actor, 'production_order.view');
  return withOrgContext(actor.organizationId, (tx) =>
    tx.productionPlanRevision.findMany({
      where: { status: 'RELEASED', productionPlan: { projectId } },
      include: {
        productionPlan: {
          select: {
            planNumber: true,
            name: true,
            productId: true,
            product: { select: { name: true } },
          },
        },
      },
      orderBy: { releasedAt: 'desc' },
    }),
  );
}

/** Active users, for the "assign someone to this order" picker. Gated on
 *  production_order.assign so a worker cannot enumerate colleagues. */
export async function listAssignableUsers(actor: Actor) {
  await assertPermission(actor, 'production_order.assign');
  return withOrgContext(actor.organizationId, (tx) =>
    tx.user.findMany({
      where: { isActive: true },
      select: { id: true, displayName: true, email: true },
      orderBy: { email: 'asc' },
    }),
  );
}
