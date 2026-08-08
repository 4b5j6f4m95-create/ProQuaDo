import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { addPlanStep } from '@/domain/production-plans/plan-steps';

const addStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  instruction: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  workCenterId: z.string().uuid().optional(),
  requiredRole: z.string().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  photoRequired: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  fourEyesRequired: z.boolean().optional(),
  fourEyesScope: z.enum(['EXECUTION_AND_REVIEW', 'REVIEW_ONLY']).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = addStepSchema.parse(await request.json());
    const step = await addPlanStep({ actor, productionPlanRevisionId: params.id, ...body });
    return NextResponse.json(step, { status: 201 });
  });
}
