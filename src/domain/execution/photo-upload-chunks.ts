import { createHash, randomUUID } from 'node:crypto';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { CorruptEvidenceError, NotFoundError, ValidationError } from '@/lib/domain-errors';
import {
  chunkStorageKey,
  deleteObjects,
  getObjectBytes,
  putObjectBytes,
} from '@/lib/storage/object-storage';
import { getMalwareScanner } from '@/lib/storage/malware-scan';
import type { Actor } from '@/domain/shared/actor';
import { loadInstanceForEvidence } from './execution-guards';

/**
 * Resumable photo upload — docs/06 "Resumable Upload (Fotos)", Negativtest
 * #14 ("Serverausfall nach Upload, vor Quittung").
 *
 * The problem it solves is narrow and real: a 12 MB photo over a hall's
 * marginal WLAN, interrupted at 80 %. Restarting from zero costs the worker
 * the same three minutes again, every time, and a queue of such retries is
 * what makes people stop taking the photos.
 *
 * The design:
 *  - the device declares total size and chunk size up front, so the server
 *    knows when the last chunk has arrived rather than believing a "done"
 *    flag;
 *  - every chunk carries its own SHA-256, checked on arrival — a chunk that
 *    arrived corrupt is rejected as a chunk, not discovered as a corrupt
 *    photo at the end;
 *  - a chunk that is re-sent because its acknowledgement was lost is
 *    recognized by (index, hash) and accepted without being stored twice.
 *    Re-sending a DIFFERENT chunk under an index that already has one is
 *    refused: that is not a retry, it is a rewrite of evidence;
 *  - assembly, the final hash and the malware scan all happen server-side.
 *    The client's declared hash is a claim that gets checked (Negativtest
 *    #7), never a fact that gets stored.
 */

const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
// docs/05 "Rate Limits & Größenlimits": 25 MB per photo.
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export interface BeginChunkedUploadCommand {
  actor: Actor;
  workStepInstanceId: string;
  mimeType: string;
  totalBytes: number;
  chunkSizeBytes: number;
  expectedHashSha256: string;
  photoRequirementId?: string;
  photoCategory?: string;
  description?: string;
  takenAt?: Date;
  deviceId?: string;
}

export interface ChunkedUploadState {
  photoEvidenceId: string;
  uploadStatus: string;
  totalBytes: number;
  chunkSizeBytes: number;
  chunkCount: number;
  receivedChunkIndexes: number[];
  uploadedBytes: number;
  /** The first index the device still has to send. Its whole reason for
   *  existing: the client resumes here instead of at zero. */
  nextChunkIndex: number | null;
  complete: boolean;
}

export async function beginChunkedPhotoUpload(
  command: BeginChunkedUploadCommand,
): Promise<ChunkedUploadState> {
  if (command.totalBytes <= 0 || command.totalBytes > MAX_PHOTO_BYTES) {
    throw new ValidationError(
      `Die Dateigröße muss zwischen 1 Byte und ${MAX_PHOTO_BYTES / (1024 * 1024)} MB liegen.`,
    );
  }
  if (command.chunkSizeBytes <= 0 || command.chunkSizeBytes > MAX_CHUNK_BYTES) {
    throw new ValidationError(
      `Die Blockgröße muss zwischen 1 Byte und ${MAX_CHUNK_BYTES / (1024 * 1024)} MB liegen.`,
    );
  }

  const chunkCount = Math.ceil(command.totalBytes / command.chunkSizeBytes);

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

    const evidence = await tx.photoEvidence.create({
      data: {
        organizationId: command.actor.organizationId,
        workStepInstanceId: instance.id,
        photoRequirementId: command.photoRequirementId,
        photoCategory: category,
        description: command.description,
        storageKey: `${command.actor.organizationId}/photo-evidence/${instance.id}/${randomUUID()}`,
        mimeType: command.mimeType,
        uploadStatus: 'PENDING',
        uploadMode: 'CHUNKED',
        declaredSizeBytes: BigInt(command.totalBytes),
        chunkSizeBytes: command.chunkSizeBytes,
        chunkCount,
        // The claimed hash is stored so the final comparison has something to
        // compare against; uploadStatus stays PENDING, so it never counts as
        // evidence on this basis alone (see step-requirements.ts).
        fileHashSha256: command.expectedHashSha256,
        takenAt: command.takenAt,
        capturedById: command.actor.userId,
        deviceId: command.deviceId,
      },
    });

    return {
      photoEvidenceId: evidence.id,
      uploadStatus: evidence.uploadStatus,
      totalBytes: command.totalBytes,
      chunkSizeBytes: command.chunkSizeBytes,
      chunkCount,
      receivedChunkIndexes: [],
      uploadedBytes: 0,
      nextChunkIndex: 0,
      complete: false,
    };
  });
}

export interface UploadChunkCommand {
  actor: Actor;
  photoEvidenceId: string;
  chunkIndex: number;
  chunk: Uint8Array;
  chunkHashSha256: string;
  deviceId?: string;
}

export async function uploadPhotoChunk(command: UploadChunkCommand): Promise<ChunkedUploadState> {
  const actualHash = createHash('sha256').update(command.chunk).digest('hex');
  if (actualHash !== command.chunkHashSha256) {
    throw new CorruptEvidenceError(
      `Block ${command.chunkIndex} kam beschädigt an (Hash weicht ab) — bitte erneut senden.`,
    );
  }

  const evidence = await withOrgContext(command.actor.organizationId, async (tx) => {
    const row = await tx.photoEvidence.findFirst({ where: { id: command.photoEvidenceId } });
    if (!row) throw new NotFoundError('Fotonachweis');
    // The step must still accept evidence: a chunk arriving for a step that
    // has meanwhile been completed is not evidence of anything.
    await loadInstanceForEvidence(tx, command.actor, row.workStepInstanceId);
    return row;
  });

  if (evidence.uploadMode !== 'CHUNKED' || evidence.chunkCount === null) {
    throw new ValidationError('Für diesen Fotonachweis wurde kein Blockupload eröffnet.');
  }
  if (evidence.uploadStatus === 'COMPLETED') {
    return readUploadState(command.actor, command.photoEvidenceId);
  }
  if (command.chunkIndex < 0 || command.chunkIndex >= evidence.chunkCount) {
    throw new ValidationError(
      `Block ${command.chunkIndex} liegt außerhalb der angekündigten ${evidence.chunkCount} Blöcke.`,
    );
  }

  const existing = await withOrgContext(command.actor.organizationId, (tx) =>
    tx.photoUploadChunk.findFirst({
      where: { photoEvidenceId: evidence.id, chunkIndex: command.chunkIndex },
    }),
  );

  if (existing) {
    // The deduplication case from docs/06: "Bei Retry: Server prüft bereits
    // vorhandene Chunks via Hash, akzeptiert nur fehlende."
    if (existing.chunkHashSha256 !== actualHash) {
      throw new CorruptEvidenceError(
        `Für Block ${command.chunkIndex} wurde bereits ein abweichender Inhalt bestätigt.`,
      );
    }
    return readUploadState(command.actor, command.photoEvidenceId);
  }

  const storageKey = chunkStorageKey(evidence.storageKey, command.chunkIndex);
  // Bytes first, row second. The reverse order could leave a chunk recorded
  // as received whose data never landed — and the resume logic would then
  // skip it forever.
  await putObjectBytes({ storageKey, body: command.chunk });

  await withOrgContext(command.actor.organizationId, async (tx) => {
    await tx.photoUploadChunk.create({
      data: {
        organizationId: command.actor.organizationId,
        photoEvidenceId: evidence.id,
        chunkIndex: command.chunkIndex,
        sizeBytes: command.chunk.byteLength,
        chunkHashSha256: actualHash,
        storageKey,
      },
    });
  });

  return readUploadState(command.actor, command.photoEvidenceId);
}

export async function readUploadState(
  actor: Actor,
  photoEvidenceId: string,
): Promise<ChunkedUploadState> {
  return withOrgContext(actor.organizationId, async (tx) => {
    const evidence = await tx.photoEvidence.findFirst({
      where: { id: photoEvidenceId },
      include: { uploadChunks: { orderBy: { chunkIndex: 'asc' } } },
    });
    if (!evidence) throw new NotFoundError('Fotonachweis');

    const received = evidence.uploadChunks.map((c) => c.chunkIndex);
    const receivedSet = new Set(received);
    const chunkCount = evidence.chunkCount ?? 0;
    let nextChunkIndex: number | null = null;
    for (let i = 0; i < chunkCount; i++) {
      if (!receivedSet.has(i)) {
        nextChunkIndex = i;
        break;
      }
    }

    return {
      photoEvidenceId: evidence.id,
      uploadStatus: evidence.uploadStatus,
      totalBytes: Number(evidence.declaredSizeBytes ?? 0n),
      chunkSizeBytes: evidence.chunkSizeBytes ?? 0,
      chunkCount,
      receivedChunkIndexes: received,
      uploadedBytes: evidence.uploadChunks.reduce((sum, c) => sum + c.sizeBytes, 0),
      nextChunkIndex,
      complete: evidence.uploadStatus === 'COMPLETED',
    };
  });
}

export interface FinishChunkedUploadCommand {
  actor: Actor;
  photoEvidenceId: string;
  expectedHashSha256: string;
  deviceId?: string;
}

/**
 * Assembles the chunks, verifies the whole file against the declared hash,
 * scans it, and only then marks the evidence COMPLETED.
 *
 * Idempotent: finishing an already COMPLETED upload with the same hash
 * returns it unchanged, which is what makes a lost acknowledgement harmless
 * (Negativtest #14).
 */
export async function finishChunkedPhotoUpload(command: FinishChunkedUploadCommand) {
  const evidence = await withOrgContext(command.actor.organizationId, async (tx) => {
    const row = await tx.photoEvidence.findFirst({
      where: { id: command.photoEvidenceId },
      include: { uploadChunks: { orderBy: { chunkIndex: 'asc' } } },
    });
    if (!row) throw new NotFoundError('Fotonachweis');
    return row;
  });

  if (evidence.uploadStatus === 'COMPLETED') {
    if (evidence.fileHashSha256 !== command.expectedHashSha256) {
      throw new ValidationError(
        'Für diesen Fotonachweis wurde bereits eine Datei mit abweichendem Hash bestätigt.',
      );
    }
    return evidence;
  }

  const chunkCount = evidence.chunkCount ?? 0;
  if (evidence.uploadChunks.length !== chunkCount) {
    const missing = [];
    const have = new Set(evidence.uploadChunks.map((c) => c.chunkIndex));
    for (let i = 0; i < chunkCount; i++) if (!have.has(i)) missing.push(i);
    throw new CorruptEvidenceError(
      `Es fehlen noch ${missing.length} von ${chunkCount} Blöcken (nächster: ${missing[0]}).`,
    );
  }

  const parts: Buffer[] = [];
  for (const chunk of evidence.uploadChunks) {
    parts.push(await getObjectBytes(chunk.storageKey));
  }
  const assembled = Buffer.concat(parts);

  const declaredSize = Number(evidence.declaredSizeBytes ?? 0n);
  if (assembled.byteLength !== declaredSize) {
    await markChunkedUploadFailed(command, evidence.id, evidence.workStepInstanceId, {
      failureReason: 'SIZE_MISMATCH',
      auditValues: { declared: declaredSize, assembled: assembled.byteLength },
    });
    throw new CorruptEvidenceError(
      `Die zusammengesetzte Datei ist ${assembled.byteLength} Byte groß, angekündigt waren ${declaredSize}.`,
    );
  }

  const actualHash = createHash('sha256').update(assembled).digest('hex');
  if (actualHash !== command.expectedHashSha256) {
    // Rejection recorded in its OWN transaction and only then thrown — see
    // the same rule in photo-evidence.ts: throwing inside the transaction
    // would roll back the record that documents the rejection.
    await markChunkedUploadFailed(command, evidence.id, evidence.workStepInstanceId, {
      failureReason: 'HASH_MISMATCH',
      auditValues: { expected: command.expectedHashSha256, actual: actualHash },
    });
    throw new CorruptEvidenceError('Datei-Hash stimmt nicht überein — Foto wird nicht anerkannt.');
  }

  await putObjectBytes({
    storageKey: evidence.storageKey,
    body: assembled,
    mimeType: evidence.mimeType ?? undefined,
  });

  const scanStatus = await getMalwareScanner().scan(evidence.storageKey);
  if (scanStatus !== 'CLEAN') {
    await markChunkedUploadFailed(command, evidence.id, evidence.workStepInstanceId, {
      failureReason: 'MALWARE_SCAN_NOT_CLEAN',
      auditValues: { malwareScanStatus: scanStatus },
    });
    throw new ValidationError('Der Virenscan des Fotos war nicht erfolgreich.');
  }

  const completed = await withOrgContext(command.actor.organizationId, async (tx) => {
    await loadInstanceForEvidence(tx, command.actor, evidence.workStepInstanceId);

    const updated = await tx.photoEvidence.update({
      where: { id: evidence.id },
      data: {
        uploadStatus: 'COMPLETED',
        fileHashSha256: actualHash,
        fileSizeBytes: BigInt(assembled.byteLength),
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
        sizeBytes: assembled.byteLength,
        uploadMode: 'CHUNKED',
        chunkCount,
      },
      deviceId: command.deviceId,
      source: 'mobile',
    });

    return updated;
  });

  // The parts have served their purpose. Deleted after the final object is
  // safely written, so a failure in between leaves a resumable upload rather
  // than nothing at all.
  await deleteObjects(evidence.uploadChunks.map((c) => c.storageKey));
  await withOrgContext(command.actor.organizationId, (tx) =>
    tx.photoUploadChunk.deleteMany({ where: { photoEvidenceId: evidence.id } }),
  );

  return completed;
}

async function markChunkedUploadFailed(
  command: FinishChunkedUploadCommand,
  photoEvidenceId: string,
  workStepInstanceId: string,
  failure: { failureReason: string; auditValues: Record<string, unknown> },
): Promise<void> {
  await withOrgContext(command.actor.organizationId, async (tx) => {
    await loadInstanceForEvidence(tx, command.actor, workStepInstanceId);

    await tx.photoEvidence.update({
      where: { id: photoEvidenceId },
      data: { uploadStatus: 'FAILED', version: { increment: 1 } },
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
      source: 'mobile',
    });
  });
}
