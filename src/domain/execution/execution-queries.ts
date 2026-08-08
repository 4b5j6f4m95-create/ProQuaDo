import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { assertOrderVisible, isAssignedToOrder } from '@/domain/production-orders/order-access';
import { findActiveHolds } from '@/domain/quality/production-holds';
import { evaluateStepRequirements, type RequirementEvaluation } from './step-requirements';

/**
 * Everything the tablet step view needs in one round trip (docs/07 A2):
 * the instruction, the pinned document revisions, the checklist with the
 * answers given so far, photo obligations with what has been uploaded,
 * measurement characteristics with what has been measured — plus the
 * server's own requirement evaluation, so the UI never has to guess what
 * "still missing" means.
 */
export async function getWorkStepInstance(actor: Actor, workStepInstanceId: string) {
  await assertPermission(actor, 'work_step.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const instance = await tx.workStepInstance.findFirst({
      where: { id: workStepInstanceId },
      include: {
        release: { select: { isValid: true, validUntil: true, releasedAt: true } },
        // Newest submission only: a step may have several once a rejected
        // completion has been corrected and resubmitted.
        completionSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            validationStatus: true,
            validationReason: true,
            submittedById: true,
          },
        },
        secondApproval: {
          select: { id: true, reviewerStatus: true, executorId: true, reviewerId: true },
        },
        originWorkStepInstance: {
          select: { id: true, stepNumber: true, stepKind: true, status: true },
        },
        derivedWorkStepInstances: {
          orderBy: { attemptNumber: 'asc' },
          select: { id: true, stepKind: true, status: true, attemptNumber: true },
        },
        nonConformance: { select: { id: true, ncrNumber: true, status: true } },
        raisedNonConformances: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            ncrNumber: true,
            status: true,
            isBlocking: true,
            description: true,
          },
        },
        productionOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            serialNumber: true,
            product: { select: { name: true } },
            project: { select: { id: true, name: true } },
          },
        },
        planStep: {
          select: {
            id: true,
            stepNumber: true,
            title: true,
            description: true,
            instruction: true,
            requiredRole: true,
            photoRequired: true,
            signatureRequired: true,
            fourEyesRequired: true,
            checklistItems: {
              orderBy: { itemNumber: 'asc' },
              select: { id: true, itemNumber: true, text: true, isRequired: true },
            },
            photoRequirements: {
              orderBy: { category: 'asc' },
              select: {
                id: true,
                category: true,
                description: true,
                minCount: true,
                maxCount: true,
              },
            },
            inspectionCharacteristics: {
              orderBy: { characteristicNumber: 'asc' },
              select: {
                id: true,
                characteristicNumber: true,
                name: true,
                nominalValue: true,
                lowerLimit: true,
                upperLimit: true,
                unit: true,
                isRequired: true,
                requiresMeasuringEquipment: true,
              },
            },
            documentBindings: {
              select: {
                id: true,
                pageNumber: true,
                markerLabel: true,
                document: { select: { id: true, documentNumber: true, title: true } },
                documentRevision: {
                  select: { id: true, revisionNumber: true, status: true },
                },
              },
            },
          },
        },
        checklistResponses: {
          select: { id: true, checklistItemId: true, response: true, comment: true },
        },
        photoEvidence: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            photoRequirementId: true,
            photoCategory: true,
            description: true,
            uploadStatus: true,
            uploadedAt: true,
          },
        },
        measurementResults: {
          select: {
            id: true,
            inspectionCharacteristicId: true,
            measuredValue: true,
            measuredUnit: true,
            isWithinTolerance: true,
            measuringEquipmentRef: true,
            measuringEquipment: { select: { id: true, equipmentNumber: true, name: true } },
          },
        },
        confirmations: { select: { id: true, confirmedAt: true, signatureMethod: true } },
      },
    });
    if (!instance) throw new NotFoundError('Arbeitsschritt');

    await assertOrderVisible(tx, actor, instance.productionOrderId);
    const assigned = await isAssignedToOrder(tx, actor, instance.productionOrderId);
    // Holds are surfaced with the step so the UI can always name the cause
    // and the next action, never just a disabled button (docs/07 F).
    const activeHolds = await findActiveHolds(tx, {
      productionOrderId: instance.productionOrderId,
      workStepInstanceId: instance.id,
    });

    const evaluation: RequirementEvaluation = evaluateStepRequirements(
      {
        photoRequired: instance.planStep.photoRequired,
        signatureRequired: instance.planStep.signatureRequired,
        fourEyesRequired: instance.planStep.fourEyesRequired,
        checklistItems: instance.planStep.checklistItems,
        photoRequirements: instance.planStep.photoRequirements,
        inspectionCharacteristics: instance.planStep.inspectionCharacteristics,
      },
      {
        checklistResponses: instance.checklistResponses,
        photos: instance.photoEvidence,
        measurements: instance.measurementResults.map((m) => ({
          inspectionCharacteristicId: m.inspectionCharacteristicId,
          isWithinTolerance: m.isWithinTolerance,
          measuredValue: m.measuredValue.toString(),
        })),
        hasConfirmation: instance.confirmations.length > 0,
      },
    );

    return {
      ...instance,
      evaluation,
      isAssignedToOrder: assigned,
      activeHolds,
      latestSubmission: instance.completionSubmissions[0] ?? null,
    };
  });
}

export async function getCompletionSubmission(actor: Actor, completionSubmissionId: string) {
  await assertPermission(actor, 'work_step.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const submission = await tx.completionSubmission.findFirst({
      where: { id: completionSubmissionId },
      include: {
        workStepInstance: {
          select: { id: true, status: true, stepNumber: true, productionOrderId: true },
        },
      },
    });
    if (!submission) throw new NotFoundError('Abschlussmeldung');
    await assertOrderVisible(tx, actor, submission.workStepInstance.productionOrderId);
    return submission;
  });
}

/** The other steps of the same order, for the "Schritt 7 von 18" context
 *  strip and to link to the successor the server just released. */
export async function listWorkStepsOfOrder(actor: Actor, productionOrderId: string) {
  await assertPermission(actor, 'work_step.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    await assertOrderVisible(tx, actor, productionOrderId);
    return tx.workStepInstance.findMany({
      where: { productionOrderId },
      orderBy: { stepNumber: 'asc' },
      include: { planStep: { select: { title: true, fourEyesRequired: true } } },
    });
  });
}
