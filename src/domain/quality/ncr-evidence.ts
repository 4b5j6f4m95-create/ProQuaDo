import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import {
  computeObjectSha256,
  createPresignedNcrEvidenceUploadUrl,
  headObject,
} from '@/lib/storage/object-storage';
import { getMalwareScanner } from '@/lib/storage/malware-scan';
import type { Actor } from '@/domain/shared/actor';
import { isNonConformanceOpen, type NonConformanceStatus } from './ncr-status';

/**
 * Photo evidence attached to a deviation report (docs/07 A9 "Foto
 * hinzufügen"). Same two-step, hash-verified flow as step photo evidence —
 * the server recomputes the digest over what actually arrived and refuses a
 * mismatch, so a broken upload can never pass as a documented finding.
 */

export interface RequestNcrEvidenceUploadCommand {
  actor: Actor;
  nonConformanceId: string;
  mimeType: string;
  description?: string;
}

export async function requestNcrEvidenceUploadUrl(command: RequestNcrEvidenceUploadCommand) {
  await assertPermission(command.actor, 'ncr.create');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const ncr = await tx.nonConformance.findFirst({ where: { id: command.nonConformanceId } });
    if (!ncr) throw new NotFoundError('Abweichung');
    if (!isNonConformanceOpen(ncr.status as NonConformanceStatus)) {
      throw new ValidationError(
        'Zu einer abgeschlossenen Abweichung können keine Nachweise mehr ergänzt werden.',
      );
    }

    const upload = await createPresignedNcrEvidenceUploadUrl({
      organizationId: command.actor.organizationId,
      nonConformanceId: ncr.id,
      mimeType: command.mimeType,
    });

    const evidence = await tx.nonConformanceEvidence.create({
      data: {
        organizationId: command.actor.organizationId,
        nonConformanceId: ncr.id,
        storageKey: upload.storageKey,
        mimeType: command.mimeType,
        description: command.description,
        uploadStatus: 'PENDING',
        capturedById: command.actor.userId,
      },
    });

    return {
      nonConformanceEvidenceId: evidence.id,
      uploadUrl: upload.uploadUrl,
      storageKey: upload.storageKey,
      expiresAt: upload.expiresAt,
    };
  });
}

export interface CompleteNcrEvidenceUploadCommand {
  actor: Actor;
  nonConformanceEvidenceId: string;
  expectedHashSha256: string;
}

export async function completeNcrEvidenceUpload(command: CompleteNcrEvidenceUploadCommand) {
  await assertPermission(command.actor, 'ncr.create');

  const existing = await withOrgContext(command.actor.organizationId, async (tx) => {
    const evidence = await tx.nonConformanceEvidence.findFirst({
      where: { id: command.nonConformanceEvidenceId },
    });
    if (!evidence) throw new NotFoundError('Abweichungsnachweis');
    return evidence;
  });

  if (existing.uploadStatus === 'COMPLETED') {
    if (existing.fileHashSha256 !== command.expectedHashSha256) {
      throw new ValidationError(
        'Für diesen Nachweis wurde bereits eine Datei mit abweichendem Hash bestätigt.',
      );
    }
    return existing;
  }

  const objectInfo = await headObject(existing.storageKey);
  if (!objectInfo) {
    throw new ValidationError('Upload nicht gefunden — bitte Datei erneut übertragen.');
  }

  const actualHash = await computeObjectSha256(existing.storageKey);
  if (actualHash !== command.expectedHashSha256) {
    // Recorded in its own transaction, then thrown — see the same pattern
    // and its rationale in src/domain/execution/photo-evidence.ts.
    await withOrgContext(command.actor.organizationId, async (tx) => {
      await tx.nonConformanceEvidence.update({
        where: { id: existing.id },
        data: { uploadStatus: 'FAILED', fileHashSha256: actualHash, version: { increment: 1 } },
      });
      await writeAuditEvent(tx, {
        organizationId: command.actor.organizationId,
        eventType: 'non_conformance.evidence_rejected',
        resourceType: 'non_conformance_evidence',
        resourceId: existing.id,
        actorId: command.actor.userId,
        newValues: { expected: command.expectedHashSha256, actual: actualHash },
        result: 'FAILURE',
        failureReason: 'HASH_MISMATCH',
        source: 'web',
      });
    });
    throw new ValidationError('Datei-Hash stimmt nicht überein — Nachweis wird nicht anerkannt.');
  }

  const scanStatus = await getMalwareScanner().scan(existing.storageKey);
  if (scanStatus !== 'CLEAN') {
    throw new ValidationError('Der Virenscan des Nachweises war nicht erfolgreich.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const updated = await tx.nonConformanceEvidence.update({
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
      eventType: 'non_conformance.evidence_added',
      resourceType: 'non_conformance_evidence',
      resourceId: updated.id,
      actorId: command.actor.userId,
      newValues: {
        nonConformanceId: updated.nonConformanceId,
        fileHashSha256: actualHash,
        sizeBytes: objectInfo.sizeBytes,
      },
      source: 'web',
    });

    return updated;
  });
}
