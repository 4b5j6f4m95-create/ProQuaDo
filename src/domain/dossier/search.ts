import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { hasPermissionWithin } from '@/lib/authz/permission-within';
import type { Actor } from '@/domain/shared/actor';

/**
 * Traceability search — docs/05 `GET /search?q=&type=serial_number|order|document`,
 * MVP feature 13, and the entry point of Abnahmeszenario F ("Auditor sucht
 * eine Seriennummer").
 *
 * Two properties that are easy to get wrong in a search and expensive to get
 * wrong here:
 *
 *  - **It is not a permission bypass.** RLS confines results to the
 *    organization, and each result type is additionally gated on the
 *    permission that governs reading it. A worker searching a serial gets
 *    orders, not documents.
 *  - **It never reports how many results it hid.** A count of suppressed
 *    matches is itself a disclosure — "there are 3 documents you may not
 *    see" tells the searcher those documents exist.
 */

export type SearchResultType = 'ORDER' | 'DOCUMENT' | 'NON_CONFORMANCE';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  /** The identifier a person recognizes: order number, document number, NCR
   *  number. */
  label: string;
  title: string;
  detail: string;
  status: string;
  href: string;
  /** Set for orders, so a hit on a serial can go straight to the dossier. */
  serialNumber?: string | null;
}

export interface SearchQuery {
  actor: Actor;
  q: string;
  type?: 'all' | 'serial_number' | 'order' | 'document';
  limit?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function searchTraceability(query: SearchQuery): Promise<SearchResult[]> {
  await assertPermission(query.actor, 'production_order.view');

  const term = query.q.trim();
  // A prefix search on an empty string would return the whole organization.
  if (term.length < 2) return [];

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const type = query.type ?? 'all';

  return withOrgContext(query.actor.organizationId, async (tx) => {
    const results: SearchResult[] = [];
    const contains = { contains: term, mode: 'insensitive' as const };

    if (type === 'all' || type === 'serial_number' || type === 'order') {
      const orders = await tx.productionOrder.findMany({
        where:
          type === 'serial_number'
            ? { serialNumber: contains }
            : {
                OR: [
                  { orderNumber: contains },
                  { serialNumber: contains },
                  { batchNumber: contains },
                ],
              },
        take: limit,
        orderBy: { orderNumber: 'asc' },
        select: {
          id: true,
          orderNumber: true,
          serialNumber: true,
          batchNumber: true,
          status: true,
          product: { select: { productNumber: true, name: true } },
          project: { select: { name: true } },
        },
      });

      for (const order of orders) {
        results.push({
          type: 'ORDER',
          id: order.id,
          label: order.orderNumber,
          title: `${order.product.productNumber} · ${order.product.name}`,
          detail:
            `Projekt ${order.project.name}` +
            (order.serialNumber ? ` · Serie ${order.serialNumber}` : '') +
            (order.batchNumber ? ` · Charge ${order.batchNumber}` : ''),
          status: order.status,
          href: `/production-orders/${order.id}`,
          serialNumber: order.serialNumber,
        });
      }
    }

    if (type === 'all' || type === 'document') {
      // Documents are their own permission, not a by-product of being able
      // to search orders.
      if (await hasPermissionWithin(tx, query.actor, 'document.view')) {
        const documents = await tx.document.findMany({
          where: { OR: [{ documentNumber: contains }, { title: contains }] },
          take: limit,
          orderBy: { documentNumber: 'asc' },
          select: {
            id: true,
            documentNumber: true,
            title: true,
            category: true,
            revisions: {
              where: { status: 'RELEASED' },
              orderBy: { releasedAt: 'desc' },
              take: 1,
              select: { revisionNumber: true, status: true },
            },
          },
        });

        for (const document of documents) {
          const released = document.revisions[0];
          results.push({
            type: 'DOCUMENT',
            id: document.id,
            label: document.documentNumber,
            title: document.title,
            detail: released
              ? `Gültige Revision ${released.revisionNumber}`
              : 'Keine freigegebene Revision',
            status: released?.status ?? 'DRAFT',
            href: `/documents/${document.id}`,
          });
        }
      }
    }

    if (type === 'all') {
      if (await hasPermissionWithin(tx, query.actor, 'ncr.view')) {
        const ncrs = await tx.nonConformance.findMany({
          where: { OR: [{ ncrNumber: contains }, { serialNumber: contains }] },
          take: limit,
          orderBy: { discoveredAt: 'desc' },
          select: {
            id: true,
            ncrNumber: true,
            description: true,
            status: true,
            isBlocking: true,
            productionOrder: { select: { orderNumber: true } },
          },
        });

        for (const ncr of ncrs) {
          results.push({
            type: 'NON_CONFORMANCE',
            id: ncr.id,
            label: ncr.ncrNumber,
            title: ncr.description.slice(0, 120),
            detail:
              `Auftrag ${ncr.productionOrder.orderNumber} · ` +
              (ncr.isBlocking ? 'blockierend' : 'nicht blockierend'),
            status: ncr.status,
            href: `/quality/ncrs/${ncr.id}`,
          });
        }
      }
    }

    return results.slice(0, limit);
  });
}

/**
 * The direct path from a serial number to its dossiers, which is what
 * Abnahmeszenario F actually asks for. Returns every order carrying the
 * serial — plural on purpose: a repeated or reworked product can legitimately
 * appear in more than one order, and picking one silently would hide the
 * others from exactly the person looking for them.
 */
export async function findOrdersBySerialNumber(actor: Actor, serialNumber: string) {
  await assertPermission(actor, 'production_order.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.productionOrder.findMany({
      where: { serialNumber },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orderNumber: true,
        serialNumber: true,
        status: true,
        actualEndAt: true,
        product: { select: { productNumber: true, name: true } },
        project: { select: { name: true } },
        dossiers: {
          orderBy: { generatedAt: 'desc' },
          select: { id: true, dossierNumber: true, generatedAt: true, templateVersion: true },
        },
      },
    }),
  );
}
