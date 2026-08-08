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
