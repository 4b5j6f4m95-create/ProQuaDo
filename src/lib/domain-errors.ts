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

/**
 * Ein Datensatz mit dieser Kennung gibt es schon.
 *
 * Getrennt von `ValidationError` (422), weil es keine formale Frage ist: die
 * Eingabe ist wohlgeformt, sie kollidiert nur mit dem Bestand. 409 sagt das,
 * 422 nicht — und ein Client, der auf `code` prüft, kann „nimm eine andere
 * Nummer" anbieten statt „prüfe deine Eingabe".
 */
export class AlreadyExistsError extends DomainError {
  constructor(message: string) {
    super('ALREADY_EXISTS', message, 409);
  }
}

/**
 * Der Körper der Anfrage war größer, als die Übertragung zulässt — und kam
 * deshalb **gekappt** an, nicht abgelehnt.
 *
 * Eigener Code, weil dieser Fall sonst als „Ein unerwarteter Fehler ist
 * aufgetreten" beim Hochladenden ankommt und im Protokoll als
 * `Failed to parse body as FormData`. Beides sagt nicht, was zu tun ist. Wer
 * eine 200-MB-Datei schickt, soll lesen, dass sie zu groß ist.
 */
export class PayloadTooLargeError extends DomainError {
  constructor(message: string) {
    super('PAYLOAD_TOO_LARGE', message, 413);
  }
}

// ── Execution errors (Phase 3) ───────────────────────────────
// Codes and HTTP statuses are taken verbatim from the "Standard Error
// Codes" table in docs/05_API_CONTRACTS.md — offline clients pattern-match
// on `code`, so these strings are part of the API contract, not free text.

export class WorkStepNotReadyError extends DomainError {
  constructor(currentStatus: string) {
    super(
      'WORK_STEP_NOT_READY',
      `Der Arbeitsschritt wurde noch nicht serverseitig freigegeben (Status: ${currentStatus}).`,
      409,
    );
  }
}

export class InvalidReleaseTokenError extends DomainError {
  constructor(reason: string) {
    super(
      'INVALID_RELEASE_TOKEN',
      `Die Freigabe für diesen Arbeitsschritt konnte nicht bestätigt werden (${reason}).`,
      403,
    );
  }
}

export interface EvidenceGap {
  code: string;
  detail: string;
  affectedField?: string;
}

/** Carries the full list of unmet requirements rather than only the first —
 *  the tablet UI shows the worker everything still missing at once
 *  (docs/07 A2 "Abschließen (2 fehlend)"), and the audit event records the
 *  complete rejection reason. */
export class MissingRequiredEvidenceError extends DomainError {
  readonly gaps: readonly EvidenceGap[];

  constructor(gaps: readonly EvidenceGap[]) {
    super(
      'MISSING_REQUIRED_EVIDENCE',
      `Abschluss abgelehnt — Pflichtnachweise fehlen: ${gaps.map((g) => g.detail).join('; ')}`,
      422,
    );
    this.gaps = gaps;
  }
}

export class MeasurementOutOfToleranceError extends DomainError {
  readonly gaps: readonly EvidenceGap[];

  constructor(gaps: readonly EvidenceGap[]) {
    super(
      'MEASUREMENT_OUT_OF_TOLERANCE',
      `Abschluss abgelehnt — Messwert außerhalb Toleranz: ${gaps.map((g) => g.detail).join('; ')}`,
      422,
    );
    this.gaps = gaps;
  }
}

export class OrderOnHoldError extends DomainError {
  constructor(orderStatus: string) {
    super(
      'ORDER_ON_HOLD',
      `Der Produktionsauftrag ist gesperrt (Status: ${orderStatus}) — keine Ausführung möglich.`,
      423,
    );
  }
}

export class ConfirmationFailedError extends DomainError {
  constructor(message: string) {
    super('CONFIRMATION_FAILED', message, 403);
  }
}

/**
 * The PIN lockout from ADR-005's amendment. A separate code from
 * CONFIRMATION_FAILED on purpose: a client that cannot tell "wrong PIN" from
 * "locked, wait four minutes" will either hide the wait or keep hammering,
 * and both are worse than saying it. 423 Locked rather than 403 for the same
 * reason ORDER_ON_HOLD uses it — the request was understood and the resource
 * is temporarily refusing, which is not the same as being forbidden.
 *
 * Not in the docs/05 error table, which predates the lockout; recorded in
 * notes.md alongside the other documented deviations.
 */
export class ConfirmationLockedError extends DomainError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    super(
      'CONFIRMATION_LOCKED',
      `Zu viele fehlgeschlagene PIN-Eingaben. Die Bestätigung ist noch etwa ${minutes} Minute(n) gesperrt.`,
      423,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ── Quality errors (Phase 4) ─────────────────────────────────

/** A hold freezes work in its scope. The message always names the reason
 *  and, where configured, the condition for release — docs/07: "Sperren
 *  benötigen Ursache und nächste Handlung, nicht nur einen deaktivierten
 *  Button." */
export class ProductionHoldActiveError extends DomainError {
  constructor(holdReason: string, releaseCondition?: string) {
    super(
      'ORDER_ON_HOLD',
      `Gesperrt: ${holdReason}.${releaseCondition ? ` Freigabebedingung: ${releaseCondition}.` : ''}`,
      423,
    );
  }
}

export class BlockingNonConformanceError extends DomainError {
  constructor() {
    super(
      'BLOCKING_NCR_OPEN',
      'Eine blockierende Abweichung ist offen — der Arbeitsschritt bleibt gesperrt, bis sie abgeschlossen ist.',
      423,
    );
  }
}

export class EquipmentCalibrationExpiredError extends DomainError {
  constructor(equipmentLabel: string, detail: string) {
    super(
      'EQUIPMENT_CALIBRATION_EXPIRED',
      `Prüfmittel ${equipmentLabel} ist nicht einsatzbereit: ${detail}`,
      422,
    );
  }
}

export class SamePersonReviewDeniedError extends DomainError {
  constructor() {
    super(
      'SAME_PERSON_REVIEW_DENIED',
      'Die unabhängige Prüfung darf nicht von der ausführenden Person bestätigt werden.',
      403,
    );
  }
}

// ── Offline & sync errors (Phase 5) ──────────────────────────

/** The remote-wipe response from docs/06 "Geräteverlust und Sicherheit":
 *  the next sync health check of a revoked device fails, which is the signal
 *  the client acts on to clear its local database. 403 rather than 401 —
 *  the session is fine, the device is not. */
export class DeviceRevokedError extends DomainError {
  constructor(reason?: string) {
    super(
      'DEVICE_REVOKED',
      `Dieses Gerät wurde gesperrt und darf nicht mehr synchronisieren.${reason ? ` Grund: ${reason}` : ''}`,
      403,
    );
  }
}

/** A document or plan revision changed while the device was offline
 *  (Abnahmeszenario C, Negativtest #4). Never thrown on the sync path —
 *  there it becomes a `sync_conflicts` row for a person to decide. It exists
 *  for the online callers that must refuse outright. */
export class RevisionConflictError extends DomainError {
  constructor(detail: string) {
    super('REVISION_CONFLICT', `Revisionskonflikt: ${detail}`, 409);
  }
}

/** A chunked upload whose parts do not add up to what the device declared,
 *  or whose reassembled bytes hash differently than announced. */
export class CorruptEvidenceError extends DomainError {
  constructor(detail: string) {
    super('MISSING_OR_CORRUPT_EVIDENCE', `Nachweis nicht verwertbar: ${detail}`, 422);
  }
}
