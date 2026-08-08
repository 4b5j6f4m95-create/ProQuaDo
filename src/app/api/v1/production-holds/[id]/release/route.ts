import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { releaseProductionHold } from '@/domain/quality/production-holds';

const releaseSchema = z.object({
  releaseReason: z.string().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = releaseSchema.parse(await request.json());
    const hold = await releaseProductionHold({ actor, productionHoldId: params.id, ...body });
    return NextResponse.json(hold);
  });
}
