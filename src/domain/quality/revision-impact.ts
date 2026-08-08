import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import {
  countsAsPredecessorSatisfied,
  type WorkStepStatus,
} from '@/domain/execution/work-step-status';

/**
 * Revisionsauswirkungsanalyse (docs/07 B2, MVP plan Phase 4): before a new
 * document revision is released, which running orders are working against
 * the revision it replaces?
 *
 * This is read-only on purpose. It answers "who is affected and how far
 * along are they", which is what a project lead needs in front of them when
 * they release. Recording a per-order decision (keine Aktion / Kenntnisnahme
 * / Zusatzprüfung / Nacharbeit / Sperren) is Phase 5's conflict handling —
 * the same decision surface that offline revision conflicts need, and
 * building half of it here would mean building it twice.
 */

export type ImpactSeverity = 'ALREADY_COMPLETED' | 'IN_EXECUTION' | 'NOT_STARTED';

export interface AffectedWorkStep {
  workStepInstanceId: string;
  stepNumber: number;
  stepTitle: string;
  status: string;
  severity: ImpactSeverity;
}

export interface AffectedOrder {
  productionOrderId: string;
  orderNumber: string;
  serialNumber: string | null;
  orderStatus: string;
  affectedSteps: AffectedWorkStep[];
}

export interface RevisionImpactReport {
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  analyzedRevisionId: string;
  analyzedRevisionNumber: string;
  affectedOrders: AffectedOrder[];
}

/**
 * @param documentRevisionId the revision that is (still) bound to plan
 * steps — i.e. the one about to be superseded.
 */
export async function analyzeDocumentRevisionImpact(
  actor: Actor,
  documentRevisionId: string,
): Promise<RevisionImpactReport> {
  await assertPermission(actor, 'document.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const revision = await tx.documentRevision.findFirst({
      where: { id: documentRevisionId },
      include: { document: { select: { id: true, documentNumber: true, title: true } } },
    });
    if (!revision) throw new NotFoundError('Dokumentrevision');

    // Which plan steps pin this exact revision (bindings are always to a
    // specific revision, never to "latest" — Geschäftsgrundsatz 6).
    const bindings = await tx.stepDocumentBinding.findMany({
      where: { documentRevisionId: revision.id },
      select: { planStepId: true },
    });
    const planStepIds = [...new Set(bindings.map((b) => b.planStepId))];
    if (planStepIds.length === 0) {
      return emptyReport(revision);
    }

    const instances = await tx.workStepInstance.findMany({
      where: {
        planStepId: { in: planStepIds },
        productionOrder: {
          status: { in: ['RELEASED', 'IN_PROGRESS', 'PAUSED', 'ON_HOLD', 'QUALITY_BLOCKED'] },
        },
      },
      select: {
        id: true,
        stepNumber: true,
        status: true,
        productionOrderId: true,
        planStep: { select: { title: true } },
        productionOrder: {
          select: { id: true, orderNumber: true, serialNumber: true, status: true },
        },
      },
      orderBy: [{ productionOrderId: 'asc' }, { stepNumber: 'asc' }],
    });

    const byOrder = new Map<string, AffectedOrder>();
    for (const instance of instances) {
      const existing = byOrder.get(instance.productionOrderId) ?? {
        productionOrderId: instance.productionOrder.id,
        orderNumber: instance.productionOrder.orderNumber,
        serialNumber: instance.productionOrder.serialNumber,
        orderStatus: instance.productionOrder.status,
        affectedSteps: [],
      };
      existing.affectedSteps.push({
        workStepInstanceId: instance.id,
        stepNumber: instance.stepNumber,
        stepTitle: instance.planStep.title,
        status: instance.status,
        severity: classifySeverity(instance.status as WorkStepStatus),
      });
      byOrder.set(instance.productionOrderId, existing);
    }

    return {
      documentId: revision.document.id,
      documentNumber: revision.document.documentNumber,
      documentTitle: revision.document.title,
      analyzedRevisionId: revision.id,
      analyzedRevisionNumber: revision.revisionNumber,
      affectedOrders: [...byOrder.values()],
    };
  });
}

/**
 * A step already executed against the old revision is a documented
 * historical fact and must never be rewritten (Abnahmeszenario C) — it is
 * reported so someone can decide whether extra inspection or rework is
 * needed. A step not yet started simply picks up the new revision.
 */
function classifySeverity(status: WorkStepStatus): ImpactSeverity {
  if (countsAsPredecessorSatisfied(status)) return 'ALREADY_COMPLETED';
  if (status === 'LOCKED' || status === 'READY') return 'NOT_STARTED';
  return 'IN_EXECUTION';
}

function emptyReport(revision: {
  id: string;
  revisionNumber: string;
  document: { id: string; documentNumber: string; title: string };
}): RevisionImpactReport {
  return {
    documentId: revision.document.id,
    documentNumber: revision.document.documentNumber,
    documentTitle: revision.document.title,
    analyzedRevisionId: revision.id,
    analyzedRevisionNumber: revision.revisionNumber,
    affectedOrders: [],
  };
}
