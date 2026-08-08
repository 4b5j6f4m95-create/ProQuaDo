import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { releaseProductionOrder } from '@/domain/production-orders/release-production-order';

const releaseSchema = z.object({
  expectedVersion: z.number().int(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = releaseSchema.parse(await request.json());
    const result = await releaseProductionOrder({
      actor,
      productionOrderId: params.id,
      expectedVersion: body.expectedVersion,
    });
    // The release tokens of the newly released entry steps are part of the
    // response on purpose: this is the one moment they exist in clear text
    // (the server stores only their hashes). A future offline client picks
    // them up here or via the sync API.
    return NextResponse.json(result);
  });
}
