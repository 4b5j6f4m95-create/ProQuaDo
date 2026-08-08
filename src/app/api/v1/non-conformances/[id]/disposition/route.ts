import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { disposeNonConformance } from '@/domain/quality/ncr-workflow';

const dispositionSchema = z.object({
  dispositionType: z.enum(['REWORK', 'CONCESSION', 'SCRAP']),
  dispositionReason: z.string().min(1).max(4000),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = dispositionSchema.parse(await request.json());
    const ncr = await disposeNonConformance({ actor, nonConformanceId: params.id, ...body });
    return NextResponse.json(ncr);
  });
}
