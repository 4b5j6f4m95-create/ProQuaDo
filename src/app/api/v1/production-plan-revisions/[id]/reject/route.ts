import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { rejectProductionPlan } from '@/domain/production-plans/plan-review-workflow';

const rejectSchema = z.object({ reason: z.string().min(1) });

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = rejectSchema.parse(await request.json());
    const revision = await rejectProductionPlan({
      actor,
      productionPlanRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(revision);
  });
}
