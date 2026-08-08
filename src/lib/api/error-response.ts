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
