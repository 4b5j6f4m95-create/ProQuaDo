import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProductionPlan } from '@/domain/production-plans/create-production-plan';
import { listProductionPlans } from '@/domain/production-plans/plan-queries';

const createPlanSchema = z.object({
  projectId: z.string().uuid(),
  productId: z.string().uuid(),
  planNumber: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createPlanSchema.parse(await request.json());
    const result = await createProductionPlan({ actor, ...body });
    return NextResponse.json(result, { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const projectId = new URL(request.url).searchParams.get('projectId') ?? undefined;
    const plans = await listProductionPlans(actor, { projectId });
    return NextResponse.json(plans);
  });
}
