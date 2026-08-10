import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { containNonConformance } from '@/domain/quality/ncr-workflow';

const containSchema = z.object({
  immediateAction: z.string().min(1).max(4000),
  rootCause: z.string().max(4000).optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = containSchema.parse(await request.json());
    const ncr = await containNonConformance({ actor, nonConformanceId: params.id, ...body });
    return NextResponse.json(ncr);
  });
}
