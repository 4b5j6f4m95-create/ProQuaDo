import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { addPlanStepDependency } from '@/domain/production-plans/plan-steps';

const addDependencySchema = z.object({
  dependentStepId: z.string().uuid(),
  predecessorStepId: z.string().uuid(),
  dependencyType: z.string().optional(),
  lagMinutes: z.number().int().min(0).optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = addDependencySchema.parse(await request.json());
    const dependency = await addPlanStepDependency({
      actor,
      productionPlanRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(dependency, { status: 201 });
  });
}
