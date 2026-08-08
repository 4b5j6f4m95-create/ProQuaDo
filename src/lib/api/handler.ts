import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { toErrorResponse } from './error-response';

/**
 * Every API route handler wraps its body in this — resolves a correlation
 * ID (client-supplied or generated) and maps any thrown AuthzError/
 * DomainError/unexpected error to the standard response shape. See
 * docs/05_API_CONTRACTS.md "Standard-Fehlerformat".
 */
export async function withErrorHandling(
  request: Request,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') ?? randomUUID();
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error, request, correlationId);
  }
}
