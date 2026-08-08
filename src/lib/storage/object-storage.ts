import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

// ADR-003: S3-compatible object storage behind a narrow adapter so the
// domain layer never imports the AWS SDK directly. Local dev talks to
// MinIO (see docker-compose.yml); production talks to real S3 — same code.
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

function s3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

function bucket(): string {
  const name = process.env.S3_BUCKET;
  if (!name) throw new Error('S3_BUCKET is not configured');
  return name;
}

export interface PresignedUpload {
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
}

/**
 * Storage keys are namespaced by organization so a leaked/misconfigured
 * bucket policy on one prefix cannot expose another organization's files —
 * defense in depth alongside RLS on the document_revisions metadata row.
 */
export async function createPresignedUploadUrl(params: {
  organizationId: string;
  documentRevisionId: string;
  mimeType: string;
}): Promise<PresignedUpload> {
  return presign(
    `${params.organizationId}/document-revisions/${params.documentRevisionId}/${randomUUID()}`,
    params.mimeType,
  );
}

/** Photo evidence lives under its own prefix, still namespaced by
 *  organization for the same reason as documents. Keyed by work step
 *  instance so the production dossier export (Phase 6) can enumerate a
 *  step's evidence by prefix alone. */
export async function createPresignedPhotoUploadUrl(params: {
  organizationId: string;
  workStepInstanceId: string;
  mimeType: string;
}): Promise<PresignedUpload> {
  return presign(
    `${params.organizationId}/photo-evidence/${params.workStepInstanceId}/${randomUUID()}`,
    params.mimeType,
  );
}

async function presign(storageKey: string, mimeType: string): Promise<PresignedUpload> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: storageKey,
    ContentType: mimeType,
  });
  const uploadUrl = await getSignedUrl(s3Client(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return {
    uploadUrl,
    storageKey,
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
  };
}

export async function headObject(storageKey: string): Promise<{ sizeBytes: number } | null> {
  try {
    const result = await s3Client().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: storageKey }),
    );
    return { sizeBytes: result.ContentLength ?? 0 };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Streams the object back and computes SHA-256 server-side — the server
 * never trusts a client-declared hash for the "is this upload intact"
 * decision (docs/09_TEST_PYRAMID.md Negativtest #7: "Bildupload
 * unvollständig oder Hash falsch: Abschluss abgelehnt"). Fine for
 * document-sized files (drawings, PDFs); would need chunked/streaming
 * comparison for very large files, not needed at MVP scale.
 */
export async function computeObjectSha256(storageKey: string): Promise<string> {
  const result = await s3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: storageKey }));
  const hash = createHash('sha256');
  const stream = result.Body as Readable;
  for await (const chunk of stream) {
    hash.update(chunk as Uint8Array);
  }
  return hash.digest('hex');
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotFound' || error.name === 'NoSuchKey')
  );
}
