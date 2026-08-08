import {
  hashIdSet,
  hashTokenSignature,
  issueReleaseToken,
  newTokenNonce,
  verifyReleaseToken,
  type ReleaseTokenPayload,
} from '../release-token';

const ORIGINAL_SECRET = process.env.RELEASE_TOKEN_SECRET;

beforeAll(() => {
  process.env.RELEASE_TOKEN_SECRET = 'unit-test-secret-not-used-anywhere-else';
});

afterAll(() => {
  process.env.RELEASE_TOKEN_SECRET = ORIGINAL_SECRET;
});

function payload(overrides: Partial<ReleaseTokenPayload> = {}): ReleaseTokenPayload {
  return {
    workStepInstanceId: 'step-7',
    productionOrderId: 'order-1',
    organizationId: 'org-1',
    releasedAt: '2026-08-08T10:00:00.000Z',
    issuingSystemInstance: 'test-node',
    planRevisionId: 'plan-rev-1',
    requirementsHash: 'req-hash',
    documentSetHash: 'doc-hash',
    entityVersion: 3,
    tokenId: 'nonce-abc',
    ...overrides,
  };
}

describe('issueReleaseToken / verifyReleaseToken', () => {
  it('round-trips a token it issued', () => {
    const token = issueReleaseToken(payload());
    const verification = verifyReleaseToken(token.encoded);

    expect(verification.valid).toBe(true);
    if (!verification.valid) return;
    expect(verification.payload.workStepInstanceId).toBe('step-7');
    expect(verification.payload.tokenId).toBe('nonce-abc');
  });

  // Negativtest #2: a client cannot mint or edit a release. Re-encoding a
  // payload with a different step id keeps the old signature, which no
  // longer matches.
  it('rejects a token whose payload was tampered with', () => {
    const token = issueReleaseToken(payload());
    const [encodedPayload, signature] = token.encoded.split('.');
    const decoded = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8'));
    decoded.workStepInstanceId = 'step-8';
    const forged = `${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${signature}`;

    expect(verifyReleaseToken(forged)).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueReleaseToken(payload());
    process.env.RELEASE_TOKEN_SECRET = 'a-different-secret';
    const verification = verifyReleaseToken(token.encoded);
    process.env.RELEASE_TOKEN_SECRET = 'unit-test-secret-not-used-anywhere-else';

    expect(verification).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects malformed input instead of throwing', () => {
    expect(verifyReleaseToken('')).toEqual({ valid: false, reason: 'MALFORMED' });
    expect(verifyReleaseToken('no-separator')).toEqual({ valid: false, reason: 'MALFORMED' });
    expect(verifyReleaseToken('bm90LWpzb24.signature')).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });
  });

  it('rejects an expired token', () => {
    const token = issueReleaseToken(payload({ validUntil: '2026-08-08T12:00:00.000Z' }));

    expect(verifyReleaseToken(token.encoded, new Date('2026-08-08T11:59:00Z')).valid).toBe(true);
    expect(verifyReleaseToken(token.encoded, new Date('2026-08-08T12:01:00Z'))).toEqual({
      valid: false,
      reason: 'EXPIRED',
    });
  });

  it('gives two different steps two unrelated tokens', () => {
    const forStep7 = issueReleaseToken(payload({ workStepInstanceId: 'step-7' }));
    const forStep8 = issueReleaseToken(
      payload({ workStepInstanceId: 'step-8', tokenId: 'nonce-def' }),
    );

    expect(forStep7.signature).not.toBe(forStep8.signature);
    // Nothing in step 7's token can be re-used to prove step 8's release —
    // the step id is inside the signed payload (docs/06).
    const verification = verifyReleaseToken(forStep7.encoded);
    expect(verification.valid && verification.payload.workStepInstanceId).toBe('step-7');
  });

  it('produces a stable signature for the same payload', () => {
    expect(issueReleaseToken(payload()).signature).toBe(issueReleaseToken(payload()).signature);
  });
});

describe('hashTokenSignature', () => {
  it('is deterministic and does not return the signature itself', () => {
    const token = issueReleaseToken(payload());
    expect(hashTokenSignature(token.signature)).toBe(hashTokenSignature(token.signature));
    expect(hashTokenSignature(token.signature)).not.toBe(token.signature);
    expect(hashTokenSignature(token.signature)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('newTokenNonce', () => {
  it('never repeats', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => newTokenNonce()));
    expect(nonces.size).toBe(100);
  });
});

describe('hashIdSet', () => {
  it('is order-insensitive', () => {
    expect(hashIdSet(['a', 'b', 'c'])).toBe(hashIdSet(['c', 'a', 'b']));
  });

  it('changes when the set changes', () => {
    expect(hashIdSet(['a', 'b'])).not.toBe(hashIdSet(['a', 'b', 'c']));
    expect(hashIdSet([])).not.toBe(hashIdSet(['a']));
  });
});
