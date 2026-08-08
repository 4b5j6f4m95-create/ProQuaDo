import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { InvalidReleaseTokenError, NotFoundError } from '@/lib/domain-errors';
import {
  hashIdSet,
  hashTokenSignature,
  issueReleaseToken,
  newTokenNonce,
  type ReleaseTokenPayload,
} from '@/lib/security/release-token';
import type { Actor } from '@/domain/shared/actor';
import { assertDeviceActive, touchDevice } from './device-registry';

/**
 * "Für Offline vorbereiten" — everything a tablet must carry into a hall
 * with no connectivity, fetched in one request (docs/06 "Lokale
 * Speicherung", docs/10 Phase 5 "Release Token: Ausstellung, Signierung,
 * Client-seitige Validierung").
 *
 * The bundle contains reference data and, for every step that is READY
 * *right now*, a freshly minted release token. What it deliberately does NOT
 * contain is a token for any step that is still LOCKED. That is the whole
 * invariant in one sentence: a device can only ever hold proof for steps the
 * server has already released, so no amount of offline time can turn it into
 * permission to start the next one (Negativtest #1).
 */

export interface OfflineBundleStep {
  workStepInstanceId: string;
  stepNumber: number;
  stepKind: string;
  status: string;
  version: number;
  title: string;
  description: string | null;
  instruction: string | null;
  photoRequired: boolean;
  signatureRequired: boolean;
  fourEyesRequired: boolean;
  checklistItems: Array<{ id: string; itemNumber: number; text: string; isRequired: boolean }>;
  photoRequirements: Array<{
    id: string;
    category: string;
    description: string | null;
    minCount: number;
    maxCount: number | null;
  }>;
  inspectionCharacteristics: Array<{
    id: string;
    characteristicNumber: number;
    name: string;
    unit: string | null;
    nominalValue: string | null;
    lowerLimit: string | null;
    upperLimit: string | null;
    isRequired: boolean;
    requiresMeasuringEquipment: boolean;
  }>;
  documentRevisions: Array<{
    documentRevisionId: string;
    documentNumber: string;
    title: string;
    revisionNumber: string;
    pageNumber: number | null;
    markerLabel: string | null;
  }>;
  /** Present only for steps in READY — see the module comment. */
  releaseToken: string | null;
  releaseValidUntil: string | null;
}

export interface OfflineBundleOrder {
  productionOrderId: string;
  orderNumber: string;
  serialNumber: string | null;
  status: string;
  productName: string;
  projectName: string;
  steps: OfflineBundleStep[];
}

export interface OfflineBundle {
  generatedAt: string;
  deviceId: string;
  cursor: string;
  orders: OfflineBundleOrder[];
}

export async function buildOfflineBundle(actor: Actor, deviceId: string): Promise<OfflineBundle> {
  await assertPermission(actor, 'sync.execute');

  return withOrgContext(actor.organizationId, async (tx) => {
    await assertDeviceActive(tx, actor, deviceId);
    await touchDevice(tx, deviceId, false);

    const assignments = await tx.orderAssignment.findMany({
      where: { userId: actor.userId, revokedAt: null },
      select: { productionOrderId: true },
    });
    const orderIds = assignments.map((a) => a.productionOrderId);

    const orders = orderIds.length
      ? await tx.productionOrder.findMany({
          where: {
            id: { in: orderIds },
            status: { in: ['RELEASED', 'IN_PROGRESS', 'PAUSED', 'QUALITY_BLOCKED'] },
          },
          orderBy: { orderNumber: 'asc' },
          select: {
            id: true,
            orderNumber: true,
            serialNumber: true,
            status: true,
            product: { select: { name: true } },
            project: { select: { name: true } },
            workStepInstances: {
              orderBy: [{ stepNumber: 'asc' }, { attemptNumber: 'asc' }],
              select: {
                id: true,
                stepNumber: true,
                stepKind: true,
                status: true,
                version: true,
                planStep: {
                  select: {
                    title: true,
                    description: true,
                    instruction: true,
                    photoRequired: true,
                    signatureRequired: true,
                    fourEyesRequired: true,
                    checklistItems: {
                      orderBy: { itemNumber: 'asc' },
                      select: { id: true, itemNumber: true, text: true, isRequired: true },
                    },
                    photoRequirements: {
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
                        unit: true,
                        nominalValue: true,
                        lowerLimit: true,
                        upperLimit: true,
                        isRequired: true,
                        requiresMeasuringEquipment: true,
                      },
                    },
                    documentBindings: {
                      select: {
                        pageNumber: true,
                        markerLabel: true,
                        documentRevision: {
                          select: {
                            id: true,
                            revisionNumber: true,
                            title: true,
                            document: { select: { documentNumber: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];

    const bundleOrders: OfflineBundleOrder[] = [];
    for (const order of orders) {
      const steps: OfflineBundleStep[] = [];
      for (const instance of order.workStepInstances) {
        const token =
          instance.status === 'READY'
            ? await reissueReleaseTokenWithin(tx, {
                organizationId: actor.organizationId,
                workStepInstanceId: instance.id,
                requestedById: actor.userId,
                deviceId,
              })
            : null;

        steps.push({
          workStepInstanceId: instance.id,
          stepNumber: instance.stepNumber,
          stepKind: instance.stepKind,
          status: instance.status,
          version: instance.version,
          title: instance.planStep.title,
          description: instance.planStep.description,
          instruction: instance.planStep.instruction,
          photoRequired: instance.planStep.photoRequired,
          signatureRequired: instance.planStep.signatureRequired,
          fourEyesRequired: instance.planStep.fourEyesRequired,
          checklistItems: instance.planStep.checklistItems,
          photoRequirements: instance.planStep.photoRequirements,
          inspectionCharacteristics: instance.planStep.inspectionCharacteristics.map((c) => ({
            ...c,
            nominalValue: c.nominalValue?.toString() ?? null,
            lowerLimit: c.lowerLimit?.toString() ?? null,
            upperLimit: c.upperLimit?.toString() ?? null,
          })),
          documentRevisions: instance.planStep.documentBindings.map((b) => ({
            documentRevisionId: b.documentRevision.id,
            documentNumber: b.documentRevision.document.documentNumber,
            title: b.documentRevision.title,
            revisionNumber: b.documentRevision.revisionNumber,
            pageNumber: b.pageNumber,
            markerLabel: b.markerLabel,
          })),
          releaseToken: token?.encoded ?? null,
          releaseValidUntil: token?.validUntil ?? null,
        });
      }

      bundleOrders.push({
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        serialNumber: order.serialNumber,
        status: order.status,
        productName: order.product.name,
        projectName: order.project.name,
        steps,
      });
    }

    const cursor = await tx.syncCursor.findFirst({
      where: { userId: actor.userId, deviceId },
      select: { lastCursor: true },
    });

    return {
      generatedAt: new Date().toISOString(),
      deviceId,
      cursor: (cursor?.lastCursor ?? 0n).toString(),
      orders: bundleOrders,
    };
  });
}

export interface ReissuedToken {
  encoded: string;
  validUntil: string;
}

/**
 * Mints a NEW token for a step that is already released, so the device can
 * carry proof of that release offline.
 *
 * This is a re-issue, not a second release: it never changes the step's
 * status, it never creates a release, and it refuses outright unless a valid
 * `work_step_releases` row already exists. The server only ever stores the
 * hash of the signature (see release-token.ts), so an existing token cannot
 * be handed out again — a fresh one is minted and the stored hash is
 * replaced, which invalidates whatever was issued before. That is deliberate:
 * exactly one device can hold a usable token for a step at a time, so a
 * tablet that was lost cannot keep working against a step that has since
 * been handed to somebody else's device.
 */
export async function reissueReleaseTokenWithin(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    workStepInstanceId: string;
    requestedById: string;
    deviceId: string;
  },
): Promise<ReissuedToken> {
  const instance = await tx.workStepInstance.findFirst({
    where: { id: params.workStepInstanceId },
    include: {
      release: true,
      productionOrder: { select: { id: true, productionPlanRevisionId: true } },
      planStep: {
        select: {
          photoRequired: true,
          signatureRequired: true,
          fourEyesRequired: true,
          checklistItems: { select: { id: true } },
          photoRequirements: { select: { id: true } },
          inspectionCharacteristics: { select: { id: true } },
          documentBindings: { select: { documentRevisionId: true } },
        },
      },
    },
  });
  if (!instance) throw new NotFoundError('Arbeitsschritt');

  if (instance.status !== 'READY' || !instance.release || !instance.release.isValid) {
    throw new InvalidReleaseTokenError(
      'für diesen Arbeitsschritt liegt keine gültige Serverfreigabe vor',
    );
  }

  const requirementsHash = hashIdSet([
    ...instance.planStep.checklistItems.map((i) => `checklist:${i.id}`),
    ...instance.planStep.photoRequirements.map((r) => `photo:${r.id}`),
    ...instance.planStep.inspectionCharacteristics.map((c) => `measurement:${c.id}`),
    `flags:${instance.planStep.photoRequired}:${instance.planStep.signatureRequired}:${instance.planStep.fourEyesRequired}`,
  ]);
  const documentSetHash = hashIdSet(
    instance.planStep.documentBindings.map((b) => b.documentRevisionId),
  );

  // The token never outlives the release it proves.
  const validUntil = instance.release.validUntil ?? undefined;
  const payload: ReleaseTokenPayload = {
    workStepInstanceId: instance.id,
    productionOrderId: instance.productionOrderId,
    organizationId: params.organizationId,
    releasedAt: instance.release.releasedAt.toISOString(),
    issuingSystemInstance: process.env.SERVER_NODE_ID ?? 'unknown',
    planRevisionId: instance.productionOrder.productionPlanRevisionId,
    requirementsHash,
    documentSetHash,
    entityVersion: instance.version,
    tokenId: newTokenNonce(),
    ...(validUntil ? { validUntil: validUntil.toISOString() } : {}),
  };
  const token = issueReleaseToken(payload);

  await tx.workStepRelease.update({
    where: { id: instance.release.id },
    data: {
      tokenHash: hashTokenSignature(token.signature),
      tokenNonce: payload.tokenId,
      requirementsHash,
      documentSetHash,
      version: { increment: 1 },
    },
  });

  await writeAuditEvent(tx, {
    organizationId: params.organizationId,
    eventType: 'work_step.release_token_issued',
    resourceType: 'work_step_instance',
    resourceId: instance.id,
    actorId: params.requestedById,
    newValues: { releaseTokenNonce: payload.tokenId, deviceId: params.deviceId },
    deviceId: params.deviceId,
    source: 'mobile',
  });

  return {
    encoded: token.encoded,
    validUntil: validUntil?.toISOString() ?? '',
  };
}

export async function reissueReleaseTokenForDevice(
  actor: Actor,
  workStepInstanceId: string,
  deviceId: string,
): Promise<ReissuedToken> {
  await assertPermission(actor, 'sync.execute');

  return withOrgContext(actor.organizationId, async (tx) => {
    await assertDeviceActive(tx, actor, deviceId);

    // Assignment is checked here rather than only in startWorkStep: handing a
    // token to somebody who is not on the order would be handing out the
    // proof itself, even though the start would later fail.
    const assigned = await tx.orderAssignment.findFirst({
      where: {
        userId: actor.userId,
        revokedAt: null,
        productionOrder: { workStepInstances: { some: { id: workStepInstanceId } } },
      },
      select: { id: true },
    });
    if (!assigned) throw new NotFoundError('Arbeitsschritt');

    return reissueReleaseTokenWithin(tx, {
      organizationId: actor.organizationId,
      workStepInstanceId,
      requestedById: actor.userId,
      deviceId,
    });
  });
}
