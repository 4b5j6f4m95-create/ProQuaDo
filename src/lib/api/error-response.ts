import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthzError } from '@/lib/authz/errors';
import { DomainError } from '@/lib/domain-errors';
import { RateLimitExceededError } from './rate-limit';
import { logger } from '@/lib/logger';

// RFC-7807-ish shape from docs/05_API_CONTRACTS.md "Standard-Fehlerformat".
export interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  correlationId: string;
  errors?: Array<{ field: string; message: string }>;
}

interface CodedError {
  code: string;
  status: number;
  message: string;
}

function isCodedError(error: unknown): error is CodedError {
  return error instanceof AuthzError || error instanceof DomainError;
}

/**
 * Converts a thrown error into the standard API error response. Route
 * handlers call this from a catch block instead of hand-rolling
 * NextResponse.json — keeps every endpoint's error shape consistent, which
 * matters for offline clients that pattern-match on `code`. Handles both
 * AuthzError (src/lib/authz/errors.ts) and DomainError (src/lib/domain-errors.ts)
 * uniformly since they share the same (code, status, message) shape.
 */
export function toErrorResponse(
  error: unknown,
  request: Request,
  correlationId: string,
): NextResponse<ApiErrorBody> {
  if (isCodedError(error)) {
    return NextResponse.json(
      {
        type: `/errors/${error.code.toLowerCase().replace(/_/g, '-')}`,
        title: error.code,
        status: error.status,
        code: error.code,
        detail: error.message,
        instance: new URL(request.url).pathname,
        correlationId,
      },
      {
        status: error.status,
        // A 429 without Retry-After leaves a client guessing, and an offline
        // device that guesses wrong either hammers the server or stalls a
        // shift. The number is the one the limiter computed.
        headers:
          error instanceof RateLimitExceededError
            ? { 'retry-after': String(error.retryAfterSeconds) }
            : undefined,
      },
    );
  }

  // A malformed request body is the client's mistake, not the server's —
  // without this it would surface as a 500, and the per-field `errors` array
  // from docs/05_API_CONTRACTS.md would be lost.
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        type: '/errors/validation-failed',
        title: 'VALIDATION_ERROR',
        status: 422,
        code: 'VALIDATION_ERROR',
        detail: 'Die Anfrage entspricht nicht dem erwarteten Format.',
        instance: new URL(request.url).pathname,
        correlationId,
        errors: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  // Eine verletzte Eindeutigkeit ist die Angabe des Aufrufers, nicht ein
  // Fehler des Servers. Ohne diesen Zweig kam sie als „Ein unerwarteter
  // Fehler ist aufgetreten" (500) an — nachgemessen an einer doppelten
  // Plannummer.
  //
  // Die Meldung bleibt allgemein: mit dem Treiber-Adapter von Prisma 7 trägt
  // P2002 kein `target` mehr („Unique constraint failed on the (not
  // available)"), das verletzte Feld ist hier also nicht bekannt. Wo eine
  // genaue Auskunft möglich ist, prüft der Dienst selbst vorher und wirft
  // `AlreadyExistsError` mit Klartext — siehe createProductionPlan. Dieser
  // Zweig ist das Netz darunter, kein Ersatz dafür.
  if (isUniqueConstraintViolation(error)) {
    logger.warn({ err: error, correlationId }, 'Unique constraint violation');
    return NextResponse.json(
      {
        type: '/errors/already-exists',
        title: 'ALREADY_EXISTS',
        status: 409,
        code: 'ALREADY_EXISTS',
        detail: 'Ein Eintrag mit diesen Werten existiert bereits.',
        instance: new URL(request.url).pathname,
        correlationId,
      },
      { status: 409 },
    );
  }

  logger.error({ err: error, correlationId }, 'Unhandled error in API route');
  return NextResponse.json(
    {
      type: '/errors/internal-server-error',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      detail: 'Ein unerwarteter Fehler ist aufgetreten.',
      instance: new URL(request.url).pathname,
      correlationId,
    },
    { status: 500 },
  );
}

/**
 * Erkennt Prismas P2002 (verletzte Eindeutigkeit) ohne Typimport.
 *
 * `instanceof PrismaClientKnownRequestError` wäre der saubere Weg und ist es
 * hier nicht: die Klasse aus `@prisma/client` in diese Datei zu ziehen hinge
 * den generierten Client an jede Fehlerantwort — auch an die von Routen, die
 * gar keine Datenbank anfassen. Der Code ist Teil von Prismas öffentlicher
 * Schnittstelle und stabiler als der Importpfad.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
