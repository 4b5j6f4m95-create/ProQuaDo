import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { assertOrderVisible } from '@/domain/production-orders/order-access';

export interface NonConformanceFilter {
  productionOrderId?: string;
  status?: string;
  openOnly?: boolean;
  blockingOnly?: boolean;
}

/** NCR-Übersicht (docs/07 C1). `ncr.view` is assignment-scoped for WORKER
 *  in the permission matrix, so worker-visible listings go through the
 *  order filter; QM/PL/PM/AUDITOR see the organization's NCRs. */
export async function listNonConformances(actor: Actor, filter: NonConformanceFilter = {}) {
  await assertPermission(actor, 'ncr.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.nonConformance.findMany({
      where: {
        productionOrderId: filter.productionOrderId,
        status: filter.status,
        ...(filter.openOnly ? { status: { notIn: ['CLOSED', 'CANCELLED'] } } : {}),
        ...(filter.blockingOnly ? { isBlocking: true } : {}),
      },
      include: {
        productionOrder: { select: { id: true, orderNumber: true, serialNumber: true } },
        product: { select: { name: true } },
        workStepInstance: { select: { id: true, stepNumber: true } },
      },
      orderBy: [{ isBlocking: 'desc' }, { createdAt: 'desc' }],
    }),
  );
}

export async function getNonConformance(actor: Actor, nonConformanceId: string) {
  await assertPermission(actor, 'ncr.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const ncr = await tx.nonConformance.findFirst({
      where: { id: nonConformanceId },
      include: {
        productionOrder: {
          select: { id: true, orderNumber: true, serialNumber: true, status: true },
        },
        product: { select: { id: true, name: true, productNumber: true } },
        project: { select: { id: true, name: true } },
        workStepInstance: {
          select: {
            id: true,
            stepNumber: true,
            status: true,
            planStep: { select: { title: true } },
          },
        },
        inspectionCharacteristic: {
          select: { id: true, name: true, lowerLimit: true, upperLimit: true, unit: true },
        },
        evidence: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, description: true, uploadStatus: true, uploadedAt: true },
        },
        holds: {
          orderBy: { issuedAt: 'desc' },
          select: {
            id: true,
            scopeType: true,
            holdReason: true,
            isActive: true,
            releaseCondition: true,
          },
        },
        derivedSteps: {
          orderBy: { attemptNumber: 'asc' },
          select: {
            id: true,
            stepKind: true,
            status: true,
            attemptNumber: true,
            stepNumber: true,
          },
        },
      },
    });
    if (!ncr) throw new NotFoundError('Abweichung');

    // Same visibility rule as the order itself: an unassigned worker must
    // not learn about an order through its NCRs.
    await assertOrderVisible(tx, actor, ncr.productionOrderId);
    return ncr;
  });
}
