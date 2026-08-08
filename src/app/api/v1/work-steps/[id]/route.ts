import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { getWorkStepInstance } from '@/domain/execution/execution-queries';
import { serializeBigInt } from '@/lib/api/serialize';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const instance = await getWorkStepInstance(actor, params.id);
    const response = NextResponse.json(serializeBigInt(instance));
    // ETag/If-Match per docs/05 "ETag / Version" — offline clients use it
    // for optimistic concurrency on their sync commands.
    response.headers.set('ETag', `"v${instance.version}"`);
    return response;
  });
}
