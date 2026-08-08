import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Release tokens — the cryptographic proof that ONE specific work step was
 * released by the server before the device went offline. See
 * docs/06_OFFLINE_SYNC_CONFLICT.md "Release Token – Design".
 *
 * The single most important property, and the reason this is a signed token
 * rather than a boolean flag on the client: a token for step N carries step
 * N's id inside the signed payload, so it can never be replayed to start
 * step N+1. Releasing the successor mints its own, separate token — and
 * only after the server has validated the predecessor's completion.
 *
 * This module is pure crypto + encoding. Revocation (`work_step_releases.is_valid`)
 * is a database question and lives in the domain layer, see
 * src/domain/execution/start-work-step.ts.
 */

export interface ReleaseTokenPayload {
  workStepInstanceId: string;
  productionOrderId: string;
  organizationId: string;
  releasedAt: string; // ISO 8601
  issuingSystemInstance: string;
  planRevisionId: string;
  requirementsHash: string;
  documentSetHash: string;
  entityVersion: number;
  tokenId: string; // server nonce
  validUntil?: string; // ISO 8601
}

export interface SignedReleaseToken {
  payload: ReleaseTokenPayload;
  signature: string;
  /** What the client sends back on `POST /work-steps/{id}/start`. */
  encoded: string;
}

export type ReleaseTokenVerification =
  | { valid: true; payload: ReleaseTokenPayload; signature: string }
  | { valid: false; reason: 'MALFORMED' | 'INVALID_SIGNATURE' | 'EXPIRED' };

function secret(): string {
  const value = process.env.RELEASE_TOKEN_SECRET;
  if (!value) {
    // Failing loudly beats silently signing with an empty key: an
    // unconfigured secret would make every forged token verifiable.
    throw new Error('RELEASE_TOKEN_SECRET is not configured');
  }
  return value;
}

/**
 * Canonical JSON with sorted keys. The signature is computed over this
 * string, so a token that round-trips through a client with reordered keys
 * still verifies — and, more importantly, two different payloads can never
 * serialize to the same bytes.
 */
function canonicalize(payload: ReleaseTokenPayload): string {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(Object.fromEntries(entries));
}

function sign(payload: ReleaseTokenPayload): string {
  return createHmac('sha256', secret()).update(canonicalize(payload)).digest('base64url');
}

export function newTokenNonce(): string {
  return randomUUID();
}

/** SHA-256 of the signature — what the server persists, so that a stolen
 *  database row cannot be turned back into a usable token. */
export function hashTokenSignature(signature: string): string {
  return createHash('sha256').update(signature).digest('hex');
}

export function issueReleaseToken(payload: ReleaseTokenPayload): SignedReleaseToken {
  const signature = sign(payload);
  const encoded = `${Buffer.from(canonicalize(payload), 'utf8').toString('base64url')}.${signature}`;
  return { payload, signature, encoded };
}

/**
 * Verifies structure, signature and expiry. Deliberately does NOT check
 * revocation or step status — those are database facts the caller must
 * check in the same transaction as the state transition it guards.
 */
export function verifyReleaseToken(
  encoded: string,
  now: Date = new Date(),
): ReleaseTokenVerification {
  const separatorIndex = encoded.lastIndexOf('.');
  if (separatorIndex <= 0) return { valid: false, reason: 'MALFORMED' };

  const payloadPart = encoded.slice(0, separatorIndex);
  const signature = encoded.slice(separatorIndex + 1);

  let payload: ReleaseTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }
  if (typeof payload?.workStepInstanceId !== 'string' || typeof payload?.tokenId !== 'string') {
    return { valid: false, reason: 'MALFORMED' };
  }

  if (!signaturesMatch(sign(payload), signature)) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  if (payload.validUntil && new Date(payload.validUntil) < now) {
    return { valid: false, reason: 'EXPIRED' };
  }

  return { valid: true, payload, signature };
}

function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  // Length must be compared separately — timingSafeEqual throws on mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stable hash of a set of ids (document revisions, requirement configs).
 *  Order-insensitive so an unrelated query-order change doesn't invalidate
 *  outstanding tokens. */
export function hashIdSet(ids: readonly string[]): string {
  return createHash('sha256')
    .update([...ids].sort().join('|'))
    .digest('hex');
}
