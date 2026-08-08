import { NextResponse } from 'next/server';
import { AuthzError } from '@/lib/authz/errors';
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
}

/**
 * Converts a thrown error into the standard API error response. Route
 * handlers call this from a catch block instead of hand-rolling
 * NextResponse.json — keeps every endpoint's error shape consistent, which
 * matters for offline clients that pattern-match on `code`.
 */
export function toErrorResponse(
  error: unknown,
  request: Request,
  correlationId: string,
): NextResponse<ApiErrorBody> {
  if (error instanceof AuthzError) {
    return NextResponse.json(
      {
        type: `/errors/${error.code.toLowerCase().replace(/_/g, '-')}`,
        title: error.name,
        status: error.status,
        code: error.code,
        detail: error.message,
        instance: new URL(request.url).pathname,
        correlationId,
      },
      { status: error.status },
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
