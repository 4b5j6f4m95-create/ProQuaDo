import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { validateProductionPlanGraph } from '@/domain/production-plans/plan-review-workflow';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const result = await validateProductionPlanGraph(actor, params.id);
    return NextResponse.json(result);
  });
}
