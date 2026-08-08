import { sha256Hex } from './local-crypto';
import type { LocalBlob, LocalDb } from './local-db';

/**
 * Client half of the resumable photo upload — docs/06 `resumeUpload`.
 *
 * The whole point is the first two lines of `uploadBlob`: before sending
 * anything, ask the SERVER what it already has. The device's own record of
 * what it sent is not authoritative — an acknowledgement can be lost after
 * the server persisted the chunk, and a client that trusted only itself
 * would re-send data the server already holds, or worse, skip data it does
 * not (Negativtest #14).
 */

const DEFAULT_CHUNK_BYTES = 1024 * 1024;

export interface UploadProgress {
  photoEvidenceId: string;
  totalChunks: number;
  sentChunks: number;
}

interface ServerUploadState {
  photoEvidenceId: string;
  chunkCount: number;
  receivedChunkIndexes: number[];
  nextChunkIndex: number | null;
  complete: boolean;
}

export interface UploadDeps {
  db: LocalDb;
  deviceId: string;
  fetchJson: <T>(input: string, init?: RequestInit) => Promise<T>;
  fetchBinary: <T>(input: string, body: BodyInit, headers: Record<string, string>) => Promise<T>;
  onProgress?: (progress: UploadProgress) => void;
}

export async function uploadBlob(deps: UploadDeps, blob: LocalBlob): Promise<string> {
  const chunkSize = DEFAULT_CHUNK_BYTES;
  const bytes = new Uint8Array(blob.bytes);

  let photoEvidenceId = blob.photoEvidenceId;
  let state: ServerUploadState;

  if (photoEvidenceId) {
    state = await deps.fetchJson<ServerUploadState>(
      `/api/v1/photo-evidence/${photoEvidenceId}/upload-status`,
    );
  } else {
    state = await deps.fetchJson<ServerUploadState>(
      `/api/v1/work-steps/${blob.workStepInstanceId}/chunked-uploads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mimeType: blob.mimeType,
          totalBytes: blob.sizeBytes,
          chunkSizeBytes: chunkSize,
          expectedHashSha256: blob.sha256,
          photoRequirementId: blob.photoRequirementId,
          deviceId: deps.deviceId,
        }),
      },
    );
    photoEvidenceId = state.photoEvidenceId;
    await deps.db.putBlob({ ...blob, photoEvidenceId });
  }

  if (state.complete) return photoEvidenceId;

  const alreadyThere = new Set(state.receivedChunkIndexes);
  for (let index = 0; index < state.chunkCount; index++) {
    if (alreadyThere.has(index)) continue;

    const slice = bytes.subarray(
      index * chunkSize,
      Math.min((index + 1) * chunkSize, bytes.length),
    );
    const chunkHash = await sha256Hex(slice);

    state = await deps.fetchBinary<ServerUploadState>(
      `/api/v1/photo-evidence/${photoEvidenceId}/chunks`,
      // A copy, because subarray shares the underlying buffer and fetch may
      // read it after this loop has moved on.
      slice.slice(),
      {
        'content-type': 'application/octet-stream',
        'x-chunk-index': String(index),
        'x-chunk-hash': chunkHash,
        'x-device-id': deps.deviceId,
      },
    );

    await deps.db.putBlob({
      ...blob,
      photoEvidenceId,
      uploadedChunks: state.receivedChunkIndexes,
    });
    deps.onProgress?.({
      photoEvidenceId,
      totalChunks: state.chunkCount,
      sentChunks: state.receivedChunkIndexes.length,
    });
  }

  await deps.fetchJson(`/api/v1/photo-evidence/${photoEvidenceId}/finish-chunked`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedHashSha256: blob.sha256, deviceId: deps.deviceId }),
  });

  return photoEvidenceId;
}

/** Hash and size are computed once, at capture time, and stored with the
 *  bytes. Recomputing them later would hash whatever is in the database now,
 *  which is precisely the thing the hash is supposed to detect. */
export async function prepareBlob(params: {
  workStepInstanceId: string;
  file: Blob;
  mimeType: string;
  photoRequirementId?: string;
}): Promise<LocalBlob> {
  const bytes = await params.file.arrayBuffer();
  return {
    id: crypto.randomUUID(),
    workStepInstanceId: params.workStepInstanceId,
    mimeType: params.mimeType,
    sizeBytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    bytes,
    ...(params.photoRequirementId ? { photoRequirementId: params.photoRequirementId } : {}),
    uploadedChunks: [],
  };
}
