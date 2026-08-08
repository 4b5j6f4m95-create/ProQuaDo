// Domain-layer errors, distinct from AuthzError (src/lib/authz/errors.ts).
// Both are caught by the same src/lib/api/error-response.ts mapper so every
// API route gets the same RFC-7807-ish shape from docs/05_API_CONTRACTS.md
// regardless of which layer raised the error.
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

export class EntityVersionConflictError extends DomainError {
  constructor(entityType: string, expectedVersion: number, actualVersion: number) {
    super(
      'ENTITY_VERSION_CONFLICT',
      `${entityType} wurde zwischenzeitlich geändert (erwartet v${expectedVersion}, aktuell v${actualVersion}).`,
      409,
    );
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(entityType: string, from: string, to: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Ungültiger Statuswechsel für ${entityType}: "${from}" → "${to}" ist nicht erlaubt.`,
      409,
    );
  }
}

export class NotFoundError extends DomainError {
  constructor(entityType: string) {
    super('NOT_FOUND', `${entityType} wurde nicht gefunden.`, 404);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 422);
  }
}
