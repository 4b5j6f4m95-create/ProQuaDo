import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import {
  computeObjectSha256,
  createPresignedPhotoUploadUrl,
  headObject,
} from '@/lib/storage/object-storage';
import { getMalwareScanner } from '@/lib/storage/malware-scan';
import type { Actor } from '@/domain/shared/actor';
import { loadInstanceForEvidence } from './execution-guards';

export interface RequestPhotoUploadCommand {
  actor: Actor;
  workStepInstanceId: string;
  mimeType: string;
  photoRequirementId?: string;
  photoCategory?: string;
  description?: string;
  takenAt?: Date;
  deviceId?: string;
}

/**
 * Step 1 of photo capture (docs/07 A3): reserve a PhotoEvidence row in
 * PENDING and hand back a short-lived signed upload URL. The row exists
 * before the bytes do, so an upload that never completes leaves a visible
 * PENDING record rather than nothing at all — and PENDING never counts as
 * evidence (see step-requirements.ts).
 */
export async function requestPhotoUploadUrl(command: RequestPhotoUploadCommand) {
  await assertPermission(command.actor, 'work_step.execute');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await loadInstanceForEvidence(tx, command.actor, command.workStepInstanceId);

    let category = command.photoCategory ?? null;
    if (command.photoRequirementId) {
      const requirement = await tx.photoRequirement.findFirst({
        where: { id: command.photoRequirementId },
      });
      if (!requirement) throw new NotFoundError('Fotoanforderung');
      if (requirement.planStepId !== instance.planStepId) {
        throw new ValidationError('Die Fotoanforderung gehört nicht zu diesem Arbeitsschritt.');
      }
      category = requirement.category;
    }

    const upload = await createPresignedPhotoUploadUrl({
      organizationId: command.actor.organizationId,
      workStepInstanceId: instance.id,
      mimeType: command.mimeType,
    });

    const evidence = await tx.photoEvidence.create({
      data: {
        organizationId: command.actor.organizationId,
        workStepInstanceId: instance.id,
        photoRequirementId: command.photoRequirementId,
        photoCategory: category,
        description: command.description,
        storageKey: upload.storageKey,
        mimeType: command.mimeType,
        uploadStatus: 'PENDING',
        takenAt: command.takenAt,
        capturedById: command.actor.userId,
        deviceId: command.deviceId,
      },
    });

    return {
      photoEvidenceId: evidence.id,
      uploadUrl: upload.uploadUrl,
      storageKey: upload.storageKey,
      expiresAt: upload.expiresAt,
    };
  });
}

export interface CompletePhotoUploadCommand {
  actor: Actor;
  photoEvidenceId: string;
  expectedHashSha256: string;
  deviceId?: string;
}

/**
 * Step 2: the server re-computes SHA-256 over what actually landed in
 * object storage and refuses to mark the photo COMPLETED if it does not
 * match the client's declared hash, or if the malware scan is not CLEAN
 * (Negativtest #7). The client's hash is a claim to be checked, never a
 * fact to be stored.
 *
 * Idempotent by design: re-completing an already COMPLETED photo returns it
 * unchanged, so a retried request after a lost response (Negativtest #14)
 * does not fail and does not duplicate evidence.
 */
export async function completePhotoUpload(command: CompletePhotoUploadCommand) {
  await assertPermission(command.actor, 'work_step.execute');

  const existing = await withOrgContext(command.actor.organizationId, async (tx) => {
    const evidence = await tx.photoEvidence.findFirst({ where: { id: command.photoEvidenceId } });
    if (!evidence) throw new NotFoundError('Fotonachweis');
    return evidence;
  });

  if (existing.uploadStatus === 'COMPLETED') {
    if (existing.fileHashSha256 !== command.expectedHashSha256) {
      throw new ValidationError(
        'Für diesen Fotonachweis wurde bereits eine Datei mit abweichendem Hash bestätigt.',
      );
    }
    return existing;
  }

  const objectInfo = await headObject(existing.storageKey);
  if (!objectInfo) {
    throw new ValidationError('Upload nicht gefunden — bitte Foto erneut übertragen.');
  }

  const actualHash = await computeObjectSha256(existing.storageKey);
  const scanStatus =
    actualHash === command.expectedHashSha256
      ? await getMalwareScanner().scan(existing.storageKey)
      : null;

  // A rejection is recorded in its OWN transaction and only then thrown.
  // Marking the row FAILED and throwing inside the same transaction would
  // roll back the very record that documents the rejection, leaving the
  // photo stuck in PENDING with no trace of why it was refused.
  if (actualHash !== command.expectedHashSha256) {
    await markUploadFailed(command, existing.id, existing.workStepInstanceId, {
      failureReason: 'HASH_MISMATCH',
      data: { fileHashSha256: actualHash },
      auditValues: { expected: command.expectedHashSha256, actual: actualHash },
    });
    throw new ValidationError('Datei-Hash stimmt nicht überein — Foto wird nicht anerkannt.');
  }

  if (scanStatus !== 'CLEAN') {
    await markUploadFailed(command, existing.id, existing.workStepInstanceId, {
      failureReason: 'MALWARE_SCAN_NOT_CLEAN',
      data: { malwareScanStatus: scanStatus },
      auditValues: { malwareScanStatus: scanStatus },
    });
    throw new ValidationError('Der Virenscan des Fotos war nicht erfolgreich.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    // Re-load inside the mutating transaction: the step may have moved on
    // (or the assignment been revoked) while the hash was being computed.
    await loadInstanceForEvidence(tx, command.actor, existing.workStepInstanceId);

    const updated = await tx.photoEvidence.update({
      where: { id: existing.id },
      data: {
        uploadStatus: 'COMPLETED',
        fileHashSha256: actualHash,
        fileSizeBytes: BigInt(objectInfo.sizeBytes),
        malwareScanStatus: scanStatus,
        uploadedAt: new Date(),
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.photo_evidence_added',
      resourceType: 'photo_evidence',
      resourceId: updated.id,
      actorId: command.actor.userId,
      newValues: {
        workStepInstanceId: updated.workStepInstanceId,
        photoCategory: updated.photoCategory,
        fileHashSha256: actualHash,
        sizeBytes: objectInfo.sizeBytes,
      },
      deviceId: command.deviceId,
      source: command.deviceId ? 'mobile' : 'web',
    });

    return updated;
  });
}

async function markUploadFailed(
  command: CompletePhotoUploadCommand,
  photoEvidenceId: string,
  workStepInstanceId: string,
  failure: {
    failureReason: string;
    data: Record<string, unknown>;
    auditValues: Record<string, unknown>;
  },
): Promise<void> {
  await withOrgContext(command.actor.organizationId, async (tx) => {
    await loadInstanceForEvidence(tx, command.actor, workStepInstanceId);

    await tx.photoEvidence.update({
      where: { id: photoEvidenceId },
      data: { uploadStatus: 'FAILED', ...failure.data, version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.photo_upload_rejected',
      resourceType: 'photo_evidence',
      resourceId: photoEvidenceId,
      actorId: command.actor.userId,
      newValues: failure.auditValues,
      result: 'FAILURE',
      failureReason: failure.failureReason,
      deviceId: command.deviceId,
      source: command.deviceId ? 'mobile' : 'web',
    });
  });
}
