import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { getProductionPlanRevision } from '@/domain/production-plans/plan-queries';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const revision = await getProductionPlanRevision(actor, params.id);
    return NextResponse.json(revision);
  });
}
