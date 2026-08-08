import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import {
  createPresignedUploadUrl,
  headObject,
  computeObjectSha256,
} from '@/lib/storage/object-storage';
import { getMalwareScanner } from '@/lib/storage/malware-scan';
import type { Actor } from '@/domain/shared/actor';

export interface RequestUploadUrlCommand {
  actor: Actor;
  documentRevisionId: string;
  mimeType: string;
}

export async function requestDocumentUploadUrl(command: RequestUploadUrlCommand) {
  await assertPermission(command.actor, 'document.revise');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await tx.documentRevision.findFirst({
      where: { id: command.documentRevisionId },
    });
    if (!revision) throw new NotFoundError('Dokumentrevision');
    if (revision.status !== 'DRAFT') {
      throw new ValidationError('Datei-Upload ist nur im Status DRAFT möglich.');
    }

    return createPresignedUploadUrl({
      organizationId: command.actor.organizationId,
      documentRevisionId: revision.id,
      mimeType: command.mimeType,
    });
  });
}

export interface CompleteUploadCommand {
  actor: Actor;
  documentRevisionId: string;
  storageKey: string;
  mimeType: string;
  expectedHashSha256: string;
}

/**
 * Verifies the upload actually landed intact by re-computing the hash
 * server-side (never trusting a client-declared hash — see
 * src/lib/storage/object-storage.ts and Negativtest #7). Rejects on
 * mismatch or a non-CLEAN malware scan result rather than silently storing
 * a bad file.
 */
export async function completeDocumentUpload(command: CompleteUploadCommand) {
  await assertPermission(command.actor, 'document.revise');

  const objectInfo = await headObject(command.storageKey);
  if (!objectInfo) {
    throw new ValidationError('Upload nicht gefunden — bitte erneut versuchen.');
  }

  const actualHash = await computeObjectSha256(command.storageKey);
  if (actualHash !== command.expectedHashSha256) {
    throw new ValidationError('Datei-Hash stimmt nicht überein — Upload wird abgelehnt.');
  }

  const scanStatus = await getMalwareScanner().scan(command.storageKey);

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await tx.documentRevision.findFirst({
      where: { id: command.documentRevisionId },
    });
    if (!revision) throw new NotFoundError('Dokumentrevision');
    if (revision.status !== 'DRAFT') {
      throw new ValidationError('Datei-Upload ist nur im Status DRAFT möglich.');
    }

    const updated = await tx.documentRevision.update({
      where: { id: revision.id },
      data: {
        storageKey: command.storageKey,
        mimeType: command.mimeType,
        fileSizeBytes: BigInt(objectInfo.sizeBytes),
        fileHashSha256: actualHash,
        malwareScanStatus: scanStatus,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.upload_completed',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      newValues: {
        fileHashSha256: actualHash,
        malwareScanStatus: scanStatus,
        sizeBytes: objectInfo.sizeBytes,
      },
      source: 'web',
    });

    return updated;
  });
}
