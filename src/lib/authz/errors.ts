import type { DenialReason } from './decision';

// Maps to the RFC-7807-ish error codes in docs/05_API_CONTRACTS.md.
const STATUS_BY_REASON: Record<DenialReason, number> = {
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_QUALIFIED: 403,
  CROSS_TENANT_ACCESS_DENIED: 404, // 404, not 403 — see 08_THREAT_MODEL_PRIVACY.md IDOR guidance
};

export class AuthzError extends Error {
  readonly code: DenialReason;
  readonly status: number;

  constructor(code: DenialReason, message: string) {
    super(message);
    this.name = 'AuthzError';
    this.code = code;
    this.status = STATUS_BY_REASON[code];
  }
}
