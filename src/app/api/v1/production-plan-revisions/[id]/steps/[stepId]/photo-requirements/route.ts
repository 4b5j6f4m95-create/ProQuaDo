import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { addPhotoRequirement } from '@/domain/production-plans/plan-step-requirements';

const addRequirementSchema = z.object({
  category: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  minCount: z.number().int().positive().optional(),
  maxCount: z.number().int().positive().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string; stepId: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = addRequirementSchema.parse(await request.json());
    const requirement = await addPhotoRequirement({
      actor,
      productionPlanRevisionId: params.id,
      planStepId: params.stepId,
      ...body,
    });
    return NextResponse.json(requirement, { status: 201 });
  });
}
