import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { submitProductionPlanForReview } from '@/domain/production-plans/plan-review-workflow';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const revision = await submitProductionPlanForReview({
      actor,
      productionPlanRevisionId: params.id,
    });
    return NextResponse.json(revision);
  });
}
