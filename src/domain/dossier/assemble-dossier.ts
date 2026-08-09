import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { getProductReleaseWithin } from '@/domain/quality/product-release';

/**
 * The digital production dossier — MASTERPROMPT.md Kap. 10, all ten sections
 * in the order they are listed there.
 *
 * Read-only, and deliberately so. The dossier is defined as a
 * "reproduzierbarer Nachweis des tatsächlichen Herstellungsverlaufs": it
 * proves what the primary records say, which means it must be *derived* from
 * them every time rather than copied once. A stored snapshot would keep
 * agreeing with itself after the records had moved on — the one failure mode
 * an audit document must not have.
 *
 * What is pinned instead is the *moment*: `dataAsOf` says when the records
 * were read and `templateVersion` which layout rendered them, so two PDFs
 * that differ can always be explained (docs/10 Phase 6, Abnahmeszenario F).
 */

/** Bump when the shape or the meaning of a section changes — it travels into
 *  every export and is the answer to "why does the old PDF look different". */
export const DOSSIER_TEMPLATE_VERSION = '1.0';

export interface DossierParticipant {
  userId: string;
  displayName: string;
  email: string;
  roles: string[];
}

export interface DossierStepEvidence {
  checklist: Array<{
    itemNumber: number;
    text: string;
    response: string;
    comment: string | null;
    respondedBy: string;
    respondedAt: Date;
  }>;
  photos: Array<{
    id: string;
    category: string | null;
    description: string | null;
    uploadStatus: string;
    fileHashSha256: string | null;
    fileSizeBytes: string | null;
    storageKey: string;
    capturedBy: string;
    takenAt: Date | null;
    uploadedAt: Date | null;
  }>;
  measurements: Array<{
    characteristicNumber: number;
    name: string;
    measuredValue: string;
    unit: string | null;
    lowerLimit: string | null;
    upperLimit: string | null;
    isWithinTolerance: boolean;
    equipment: string | null;
    calibrationValidUntil: Date | null;
    measuredBy: string;
    measuredAt: Date;
  }>;
}

export interface DossierStep {
  workStepInstanceId: string;
  stepNumber: number;
  attemptNumber: number;
  stepKind: string;
  title: string;
  status: string;
  startedBy: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  originWorkStepInstanceId: string | null;
  nonConformanceNumber: string | null;
  /** Section 6: confirmations and the independent review. */
  confirmations: Array<{
    confirmedBy: string;
    confirmedAt: Date;
    signatureMethod: string;
    confirmationTextVersion: string;
    /** The digest, not a signature over the document set — see ADR-005 scope
     *  note in complete-work-step.ts. */
    signatureData: string;
  }>;
  secondApproval: {
    executor: string;
    reviewer: string | null;
    reviewerStatus: string;
    reviewerReason: string | null;
    reviewedAt: Date | null;
  } | null;
  evidence: DossierStepEvidence;
}

export interface DossierNonConformance {
  ncrNumber: string;
  status: string;
  isBlocking: boolean;
  priority: string;
  errorCategory: string | null;
  description: string;
  discoveredBy: string;
  discoveredAt: Date;
  assessmentNotes: string | null;
  immediateAction: string | null;
  rootCause: string | null;
  dispositionType: string | null;
  dispositionReason: string | null;
  dispositionBy: string | null;
  dispositionAt: Date | null;
  closedAt: Date | null;
  affectedStepNumber: number | null;
}

export interface DossierConflictDecision {
  conflictType: string;
  summary: string;
  detectedAt: Date;
  status: string;
  decisions: Array<{
    decisionType: string;
    reason: string;
    resultingAction: string | null;
    decidedBy: string;
    decidedAt: Date;
  }>;
}

export interface ProductionDossierContent {
  // 1. Deckblatt und eindeutige Identifikation
  identification: {
    dossierNumber: string;
    orderNumber: string;
    serialNumber: string | null;
    batchNumber: string | null;
    templateVersion: string;
    dataAsOf: Date;
  };
  // 2. Projekt-, Kunden-, Auftrags- und Produktdaten
  context: {
    projectNumber: string;
    projectName: string;
    customerNumber: string | null;
    customerName: string | null;
    productNumber: string;
    productName: string;
    siteCode: string;
    siteName: string;
    orderStatus: string;
    quantity: number;
    plannedStartAt: Date | null;
    plannedEndAt: Date | null;
    actualStartAt: Date | null;
    actualEndAt: Date | null;
  };
  // 3. verwendete Fertigungsplanrevision
  planRevision: {
    planNumber: string;
    planName: string;
    revisionNumber: string;
    status: string;
    releasedAt: Date | null;
    releasedBy: string | null;
  };
  // 4. verwendete Dokumente und Revisionen
  documents: Array<{
    documentNumber: string;
    title: string;
    revisionNumber: string;
    revisionStatus: string;
    fileHashSha256: string | null;
    storageKey: string | null;
    releasedAt: Date | null;
    boundToStepNumbers: number[];
  }>;
  // 5.–7. Schritte mit Bestätigungen, Prüfungen und Nachweisen
  steps: DossierStep[];
  // 8. NCRs, Entscheidungen, Sperren und Nacharbeiten
  nonConformances: DossierNonConformance[];
  holds: Array<{
    scopeType: string;
    holdReason: string;
    releaseCondition: string | null;
    isActive: boolean;
    appliedBy: string;
    appliedAt: Date;
    releasedBy: string | null;
    releasedAt: Date | null;
    releaseReason: string | null;
  }>;
  conflictDecisions: DossierConflictDecision[];
  // 9. Endprüfung und Produktfreigabe
  finalRelease: {
    orderCompleted: boolean;
    completedAt: Date | null;
    finalStepNumber: number | null;
    finalStepTitle: string | null;
    finalStepConfirmedBy: string | null;
    openBlockingNonConformances: number;
    activeHolds: number;
    /** True only when nothing is open AND the order reached COMPLETED. The
     *  dossier states this rather than implying it: an order can be
     *  COMPLETED while a non-blocking NCR is still being processed.
     *
     *  Note what this is NOT: it says the preconditions for a release are
     *  met, never that one was given. That is `decision` below. */
    releasable: boolean;
    /** The recorded product release decision, or null if nobody has made one.
     *  Since Phase 7 the dossier can answer "who released this product" with
     *  a person and a date instead of an explanation of why it cannot
     *  (Masterprompt Kap. 10, docs/adr/ADR-005 for the confirmation). */
    decision: {
      decision: string;
      decidedBy: string | null;
      decidedAt: Date;
      reason: string;
      confirmationText: string;
      confirmationTextVersion: string;
      signatureData: string;
      /** The facts as they stood when the decision was made — copied at that
       *  moment, so a later change cannot rewrite its grounds. */
      basis: {
        orderStatus: string;
        openBlockingNonConformances: number;
        activeHolds: number;
        completedSteps: number;
        totalSteps: number;
      };
    } | null;
  };
  // 10. relevanter Audit-Auszug und Erzeugungsmetadaten
  auditTrail: Array<{
    eventType: string;
    resourceType: string;
    resourceId: string | null;
    actor: string | null;
    result: string | null;
    reason: string | null;
    serverTimestamp: Date;
    clientTimestamp: Date | null;
    source: string | null;
  }>;
  participants: DossierParticipant[];
  generation: {
    generatedAt: Date;
    generatedBy: string;
    templateVersion: string;
    /** Every file the ZIP export has to contain, so the manifest and the
     *  archive are built from one list rather than two. */
    evidenceFiles: Array<{
      kind: 'DOCUMENT' | 'PHOTO' | 'NCR_EVIDENCE';
      storageKey: string;
      declaredHashSha256: string | null;
      label: string;
    }>;
  };
}

/**
 * @param productionOrderId the order the dossier is about. Lookup by serial
 * number goes through the search service, which resolves to an order id —
 * a serial is not unique enough to be an identifier on its own (docs/02
 * allows several orders per serial in rework situations).
 */
export async function assembleProductionDossier(
  actor: Actor,
  productionOrderId: string,
): Promise<ProductionDossierContent> {
  await assertPermission(actor, 'dossier.export');

  return withOrgContext(actor.organizationId, async (tx) => {
    const dataAsOf = new Date();

    const order = await tx.productionOrder.findFirst({
      where: { id: productionOrderId },
      include: {
        site: { select: { code: true, name: true } },
        project: {
          select: {
            projectNumber: true,
            name: true,
            customer: { select: { customerNumber: true, name: true } },
          },
        },
        product: { select: { productNumber: true, name: true } },
        productionPlanRevision: {
          select: {
            revisionNumber: true,
            status: true,
            releasedAt: true,
            releasedById: true,
            productionPlan: { select: { planNumber: true, name: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundError('Produktionsauftrag');

    const instances = await tx.workStepInstance.findMany({
      where: { productionOrderId: order.id },
      orderBy: [{ stepNumber: 'asc' }, { attemptNumber: 'asc' }],
      include: {
        planStep: {
          select: {
            title: true,
            checklistItems: { select: { id: true, itemNumber: true, text: true } },
            inspectionCharacteristics: {
              select: { id: true, characteristicNumber: true, name: true },
            },
            documentBindings: {
              select: {
                documentRevision: {
                  select: {
                    id: true,
                    revisionNumber: true,
                    status: true,
                    fileHashSha256: true,
                    storageKey: true,
                    releasedAt: true,
                    document: { select: { documentNumber: true, title: true } },
                  },
                },
              },
            },
          },
        },
        nonConformance: { select: { ncrNumber: true } },
        confirmations: { orderBy: { confirmedAt: 'asc' } },
        secondApproval: true,
        checklistResponses: { orderBy: { respondedAt: 'asc' } },
        photoEvidence: { orderBy: { createdAt: 'asc' } },
        measurementResults: {
          orderBy: { measuredAt: 'asc' },
          include: {
            measuringEquipment: { select: { equipmentNumber: true, name: true } },
            calibration: { select: { nextCalibrationDueAt: true } },
          },
        },
      },
    });

    const nonConformances = await tx.nonConformance.findMany({
      where: { productionOrderId: order.id },
      orderBy: { discoveredAt: 'asc' },
      include: {
        workStepInstance: { select: { stepNumber: true } },
        evidence: { select: { storageKey: true, description: true, fileHashSha256: true } },
      },
    });

    const holds = await tx.productionHold.findMany({
      where: { productionOrderId: order.id },
      orderBy: { createdAt: 'asc' },
    });

    const conflicts = await tx.syncConflict.findMany({
      where: { productionOrderId: order.id },
      orderBy: { detectedAt: 'asc' },
      include: { decisions: { orderBy: { decidedAt: 'asc' } } },
    });

    // The audit extract is scoped to this order's resources, not the whole
    // organization: a dossier that leaked unrelated events would be a
    // privacy problem, not a thorough one (docs/08).
    const resourceIds = [
      order.id,
      ...instances.map((i) => i.id),
      ...nonConformances.map((n) => n.id),
      ...holds.map((h) => h.id),
      ...conflicts.map((c) => c.id),
    ];
    const auditEvents = await tx.auditEvent.findMany({
      where: { resourceId: { in: resourceIds } },
      orderBy: { serverTimestamp: 'asc' },
    });

    const names = await resolveUserNames(
      tx,
      collectUserIds(order, instances, nonConformances, holds, conflicts, auditEvents),
    );
    const name = (id: string | null | undefined): string | null =>
      id ? (names.get(id)?.displayName ?? id) : null;

    const steps = instances.map((instance) => buildStep(instance, name));
    const documents = buildDocumentList(instances);
    const participants = await buildParticipants(tx, instances, names);
    // Read in the same transaction as everything else, so the release
    // decision belongs to the same `data_as_of` instant as the facts it is
    // shown beside.
    const productRelease = await getProductReleaseWithin(tx, order.id);
    const finalRelease = buildFinalRelease(
      order,
      instances,
      nonConformances,
      holds,
      name,
      productRelease,
    );

    return {
      identification: {
        // Provisional until the dossier row is persisted; generateDossier
        // overwrites it with the assigned number.
        dossierNumber: `AKTE-${order.orderNumber}`,
        orderNumber: order.orderNumber,
        serialNumber: order.serialNumber,
        batchNumber: order.batchNumber,
        templateVersion: DOSSIER_TEMPLATE_VERSION,
        dataAsOf,
      },
      context: {
        projectNumber: order.project.projectNumber,
        projectName: order.project.name,
        customerNumber: order.project.customer?.customerNumber ?? null,
        customerName: order.project.customer?.name ?? null,
        productNumber: order.product.productNumber,
        productName: order.product.name,
        siteCode: order.site.code,
        siteName: order.site.name,
        orderStatus: order.status,
        quantity: order.quantity,
        plannedStartAt: order.plannedStartAt,
        plannedEndAt: order.plannedEndAt,
        actualStartAt: order.actualStartAt,
        actualEndAt: order.actualEndAt,
      },
      planRevision: {
        planNumber: order.productionPlanRevision.productionPlan.planNumber,
        planName: order.productionPlanRevision.productionPlan.name,
        revisionNumber: order.productionPlanRevision.revisionNumber,
        status: order.productionPlanRevision.status,
        releasedAt: order.productionPlanRevision.releasedAt,
        releasedBy: name(order.productionPlanRevision.releasedById),
      },
      documents,
      steps,
      nonConformances: nonConformances.map((ncr) => ({
        ncrNumber: ncr.ncrNumber,
        status: ncr.status,
        isBlocking: ncr.isBlocking,
        priority: ncr.priority,
        errorCategory: ncr.errorCategory,
        description: ncr.description,
        discoveredBy: name(ncr.discoveredById) ?? ncr.discoveredById,
        discoveredAt: ncr.discoveredAt,
        assessmentNotes: ncr.assessmentNotes,
        immediateAction: ncr.immediateAction,
        rootCause: ncr.rootCause,
        dispositionType: ncr.dispositionType,
        dispositionReason: ncr.dispositionReason,
        dispositionBy: name(ncr.dispositionById),
        dispositionAt: ncr.dispositionAt,
        closedAt: ncr.closedAt,
        affectedStepNumber: ncr.workStepInstance?.stepNumber ?? null,
      })),
      holds: holds.map((hold) => ({
        scopeType: hold.scopeType,
        holdReason: hold.holdReason,
        releaseCondition: hold.releaseCondition,
        isActive: hold.isActive,
        appliedBy: name(hold.issuedById) ?? hold.issuedById,
        appliedAt: hold.createdAt,
        releasedBy: name(hold.releasedById),
        releasedAt: hold.releasedAt,
        releaseReason: hold.releaseReason,
      })),
      conflictDecisions: conflicts.map((conflict) => ({
        conflictType: conflict.conflictType,
        summary: conflict.summary,
        detectedAt: conflict.detectedAt,
        status: conflict.status,
        decisions: conflict.decisions.map((decision) => ({
          decisionType: decision.decisionType,
          reason: decision.reason,
          resultingAction: decision.resultingAction,
          decidedBy: name(decision.decidedById) ?? decision.decidedById,
          decidedAt: decision.decidedAt,
        })),
      })),
      finalRelease,
      auditTrail: auditEvents.map((event) => ({
        eventType: event.eventType,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actor: name(event.actorId),
        result: event.result,
        reason: event.reason,
        serverTimestamp: event.serverTimestamp,
        clientTimestamp: event.clientTimestamp,
        source: event.source,
      })),
      participants,
      generation: {
        generatedAt: dataAsOf,
        generatedBy: name(actor.userId) ?? actor.userId,
        templateVersion: DOSSIER_TEMPLATE_VERSION,
        evidenceFiles: collectEvidenceFiles(documents, instances, nonConformances),
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────

type InstanceRow = Prisma.WorkStepInstanceGetPayload<{
  include: {
    planStep: {
      select: {
        title: true;
        checklistItems: { select: { id: true; itemNumber: true; text: true } };
        inspectionCharacteristics: {
          select: { id: true; characteristicNumber: true; name: true };
        };
        documentBindings: {
          select: {
            documentRevision: {
              select: {
                id: true;
                revisionNumber: true;
                status: true;
                fileHashSha256: true;
                storageKey: true;
                releasedAt: true;
                document: { select: { documentNumber: true; title: true } };
              };
            };
          };
        };
      };
    };
    nonConformance: { select: { ncrNumber: true } };
    confirmations: true;
    secondApproval: true;
    checklistResponses: true;
    photoEvidence: true;
    measurementResults: {
      include: {
        measuringEquipment: { select: { equipmentNumber: true; name: true } };
        calibration: { select: { nextCalibrationDueAt: true } };
      };
    };
  };
}>;

type NcrRow = Prisma.NonConformanceGetPayload<{
  include: {
    workStepInstance: { select: { stepNumber: true } };
    evidence: { select: { storageKey: true; description: true; fileHashSha256: true } };
  };
}>;

function buildStep(instance: InstanceRow, name: (id: string | null) => string | null): DossierStep {
  const itemById = new Map(instance.planStep.checklistItems.map((i) => [i.id, i]));
  const characteristicById = new Map(
    instance.planStep.inspectionCharacteristics.map((c) => [c.id, c]),
  );

  return {
    workStepInstanceId: instance.id,
    stepNumber: instance.stepNumber,
    attemptNumber: instance.attemptNumber,
    stepKind: instance.stepKind,
    title: instance.planStep.title,
    status: instance.status,
    startedBy: name(instance.startedById),
    startedAt: instance.startedAt,
    completedAt: instance.completedAt,
    originWorkStepInstanceId: instance.originWorkStepInstanceId,
    nonConformanceNumber: instance.nonConformance?.ncrNumber ?? null,
    confirmations: instance.confirmations.map((confirmation) => ({
      confirmedBy: name(confirmation.confirmedById) ?? confirmation.confirmedById,
      confirmedAt: confirmation.confirmedAt,
      signatureMethod: confirmation.signatureMethod,
      confirmationTextVersion: confirmation.confirmationTextVersion,
      signatureData: confirmation.signatureData,
    })),
    secondApproval: instance.secondApproval
      ? {
          executor: name(instance.secondApproval.executorId) ?? instance.secondApproval.executorId,
          reviewer: name(instance.secondApproval.reviewerId),
          reviewerStatus: instance.secondApproval.reviewerStatus,
          reviewerReason: instance.secondApproval.reviewerReason,
          reviewedAt: instance.secondApproval.reviewedAt,
        }
      : null,
    evidence: {
      checklist: instance.checklistResponses.map((response) => ({
        itemNumber: itemById.get(response.checklistItemId)?.itemNumber ?? 0,
        text: itemById.get(response.checklistItemId)?.text ?? '—',
        response: response.response,
        comment: response.comment,
        respondedBy: name(response.respondedById) ?? response.respondedById,
        respondedAt: response.respondedAt,
      })),
      photos: instance.photoEvidence.map((photo) => ({
        id: photo.id,
        category: photo.photoCategory,
        description: photo.description,
        uploadStatus: photo.uploadStatus,
        fileHashSha256: photo.fileHashSha256,
        fileSizeBytes: photo.fileSizeBytes?.toString() ?? null,
        storageKey: photo.storageKey,
        capturedBy: name(photo.capturedById) ?? photo.capturedById,
        takenAt: photo.takenAt,
        uploadedAt: photo.uploadedAt,
      })),
      measurements: instance.measurementResults.map((measurement) => ({
        characteristicNumber:
          characteristicById.get(measurement.inspectionCharacteristicId)?.characteristicNumber ?? 0,
        name: characteristicById.get(measurement.inspectionCharacteristicId)?.name ?? '—',
        measuredValue: measurement.measuredValue.toString(),
        unit: measurement.measuredUnit,
        // The limits as they were COPIED onto the result, not the plan's
        // current ones — that is what makes the verdict reproducible.
        lowerLimit: measurement.lowerLimit?.toString() ?? null,
        upperLimit: measurement.upperLimit?.toString() ?? null,
        isWithinTolerance: measurement.isWithinTolerance,
        equipment: measurement.measuringEquipment
          ? `${measurement.measuringEquipment.equipmentNumber} · ${measurement.measuringEquipment.name}`
          : measurement.measuringEquipmentRef,
        calibrationValidUntil: measurement.calibration?.nextCalibrationDueAt ?? null,
        measuredBy: name(measurement.measuredById) ?? measurement.measuredById,
        measuredAt: measurement.measuredAt,
      })),
    },
  };
}

function buildDocumentList(instances: InstanceRow[]): ProductionDossierContent['documents'] {
  const byRevision = new Map<string, ProductionDossierContent['documents'][number]>();

  for (const instance of instances) {
    for (const binding of instance.planStep.documentBindings) {
      const revision = binding.documentRevision;
      const existing = byRevision.get(revision.id);
      if (existing) {
        if (!existing.boundToStepNumbers.includes(instance.stepNumber)) {
          existing.boundToStepNumbers.push(instance.stepNumber);
        }
        continue;
      }
      byRevision.set(revision.id, {
        documentNumber: revision.document.documentNumber,
        title: revision.document.title,
        revisionNumber: revision.revisionNumber,
        // Recorded as it stands now. A SUPERSEDED status here is not an
        // error — it is the fact that the drawing has since been replaced,
        // and the dossier says so rather than hiding it (Szenario C).
        revisionStatus: revision.status,
        fileHashSha256: revision.fileHashSha256,
        storageKey: revision.storageKey,
        releasedAt: revision.releasedAt,
        boundToStepNumbers: [instance.stepNumber],
      });
    }
  }

  return [...byRevision.values()].sort((a, b) =>
    a.documentNumber.localeCompare(b.documentNumber, 'de'),
  );
}

type ProductReleaseRow = {
  decision: string;
  decidedById: string;
  decidedAt: Date;
  reason: string;
  confirmationText: string;
  confirmationTextVersion: string;
  signatureData: string;
  basisOrderStatus: string;
  basisOpenBlockingNcrs: number;
  basisActiveHolds: number;
  basisCompletedSteps: number;
  basisTotalSteps: number;
};

function buildFinalRelease(
  order: { status: string; actualEndAt: Date | null },
  instances: InstanceRow[],
  nonConformances: NcrRow[],
  holds: Array<{ isActive: boolean }>,
  name: (id: string | null) => string | null,
  productRelease: ProductReleaseRow | null,
): ProductionDossierContent['finalRelease'] {
  // The last step that actually completed — not simply the highest number,
  // because a superseded attempt keeps its number.
  const completed = instances.filter((i) => i.status === 'COMPLETED');
  const last = completed.reduce<InstanceRow | null>(
    (best, i) => (!best || i.stepNumber > best.stepNumber ? i : best),
    null,
  );

  const openBlocking = nonConformances.filter(
    (ncr) => ncr.isBlocking && ncr.status !== 'CLOSED' && ncr.status !== 'CANCELLED',
  ).length;
  const activeHolds = holds.filter((hold) => hold.isActive).length;
  const orderCompleted = order.status === 'COMPLETED';

  return {
    orderCompleted,
    completedAt: order.actualEndAt,
    finalStepNumber: last?.stepNumber ?? null,
    finalStepTitle: last?.planStep.title ?? null,
    finalStepConfirmedBy: last?.confirmations[0] ? name(last.confirmations[0].confirmedById) : null,
    openBlockingNonConformances: openBlocking,
    activeHolds,
    releasable: orderCompleted && openBlocking === 0 && activeHolds === 0,
    decision: productRelease
      ? {
          decision: productRelease.decision,
          decidedBy: name(productRelease.decidedById),
          decidedAt: productRelease.decidedAt,
          reason: productRelease.reason,
          confirmationText: productRelease.confirmationText,
          confirmationTextVersion: productRelease.confirmationTextVersion,
          signatureData: productRelease.signatureData,
          basis: {
            orderStatus: productRelease.basisOrderStatus,
            openBlockingNonConformances: productRelease.basisOpenBlockingNcrs,
            activeHolds: productRelease.basisActiveHolds,
            completedSteps: productRelease.basisCompletedSteps,
            totalSteps: productRelease.basisTotalSteps,
          },
        }
      : null,
  };
}

function collectEvidenceFiles(
  documents: ProductionDossierContent['documents'],
  instances: InstanceRow[],
  nonConformances: NcrRow[],
): ProductionDossierContent['generation']['evidenceFiles'] {
  const files: ProductionDossierContent['generation']['evidenceFiles'] = [];

  for (const document of documents) {
    if (!document.storageKey) continue;
    files.push({
      kind: 'DOCUMENT',
      storageKey: document.storageKey,
      declaredHashSha256: document.fileHashSha256,
      label: `${document.documentNumber}_Rev${document.revisionNumber}`,
    });
  }

  for (const instance of instances) {
    for (const photo of instance.photoEvidence) {
      // Only completed uploads. A PENDING or FAILED row is a record that
      // something was attempted, not a file that exists — putting it in the
      // manifest would promise bytes the archive cannot deliver.
      if (photo.uploadStatus !== 'COMPLETED') continue;
      files.push({
        kind: 'PHOTO',
        storageKey: photo.storageKey,
        declaredHashSha256: photo.fileHashSha256,
        label: `Schritt${instance.stepNumber}_${photo.photoCategory ?? 'Foto'}_${photo.id.slice(0, 8)}`,
      });
    }
  }

  for (const ncr of nonConformances) {
    for (const [index, evidence] of ncr.evidence.entries()) {
      files.push({
        kind: 'NCR_EVIDENCE',
        storageKey: evidence.storageKey,
        declaredHashSha256: evidence.fileHashSha256,
        label: `${ncr.ncrNumber}_Nachweis${index + 1}`,
      });
    }
  }

  return files;
}

function collectUserIds(
  order: { createdById: string; releasedById: string | null },
  instances: InstanceRow[],
  nonConformances: NcrRow[],
  holds: Array<{ issuedById: string; releasedById: string | null }>,
  conflicts: Array<{ decisions: Array<{ decidedById: string }>; resolvedById: string | null }>,
  auditEvents: Array<{ actorId: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };

  add(order.createdById);
  add(order.releasedById);
  for (const instance of instances) {
    add(instance.startedById);
    instance.confirmations.forEach((c) => add(c.confirmedById));
    add(instance.secondApproval?.executorId);
    add(instance.secondApproval?.reviewerId);
    instance.checklistResponses.forEach((r) => add(r.respondedById));
    instance.photoEvidence.forEach((p) => add(p.capturedById));
    instance.measurementResults.forEach((m) => add(m.measuredById));
  }
  for (const ncr of nonConformances) {
    add(ncr.discoveredById);
    add(ncr.dispositionById);
    add(ncr.assignedToId);
  }
  for (const hold of holds) {
    add(hold.issuedById);
    add(hold.releasedById);
  }
  for (const conflict of conflicts) {
    add(conflict.resolvedById);
    conflict.decisions.forEach((d) => add(d.decidedById));
  }
  auditEvents.forEach((e) => add(e.actorId));

  return ids;
}

async function resolveUserNames(
  tx: Prisma.TransactionClient,
  ids: Set<string>,
): Promise<Map<string, { displayName: string; email: string }>> {
  if (ids.size === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, displayName: true, email: true },
  });
  return new Map(
    users.map((user) => [
      user.id,
      { displayName: user.displayName ?? user.email, email: user.email },
    ]),
  );
}

/**
 * Section 6 needs "Beteiligte" — everyone who touched this order — with the
 * roles they held. Roles are read as they stand now, which is a deliberate
 * simplification and a stated one: `user_roles` keeps no history, so "which
 * role did this person hold in March" is not answerable from the data. The
 * PDF labels the column accordingly.
 */
async function buildParticipants(
  tx: Prisma.TransactionClient,
  instances: InstanceRow[],
  names: Map<string, { displayName: string; email: string }>,
): Promise<DossierParticipant[]> {
  const involved = new Set<string>();
  for (const instance of instances) {
    if (instance.startedById) involved.add(instance.startedById);
    instance.confirmations.forEach((c) => involved.add(c.confirmedById));
    if (instance.secondApproval?.reviewerId) involved.add(instance.secondApproval.reviewerId);
    instance.checklistResponses.forEach((r) => involved.add(r.respondedById));
    instance.photoEvidence.forEach((p) => involved.add(p.capturedById));
    instance.measurementResults.forEach((m) => involved.add(m.measuredById));
  }
  if (involved.size === 0) return [];

  const roles = await tx.userRole.findMany({
    where: { userId: { in: [...involved] } },
    select: { userId: true, role: { select: { code: true } } },
  });
  const rolesByUser = new Map<string, string[]>();
  for (const grant of roles) {
    rolesByUser.set(grant.userId, [...(rolesByUser.get(grant.userId) ?? []), grant.role.code]);
  }

  return [...involved]
    .map((userId) => ({
      userId,
      displayName: names.get(userId)?.displayName ?? userId,
      email: names.get(userId)?.email ?? '—',
      roles: (rolesByUser.get(userId) ?? []).sort(),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
}
