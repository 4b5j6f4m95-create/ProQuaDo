import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { addChecklistItem } from '@/domain/production-plans/plan-step-requirements';

const addItemSchema = z.object({
  itemNumber: z.number().int().positive(),
  text: z.string().min(1).max(500),
  isRequired: z.boolean().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string; stepId: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = addItemSchema.parse(await request.json());
    const item = await addChecklistItem({
      actor,
      productionPlanRevisionId: params.id,
      planStepId: params.stepId,
      ...body,
    });
    return NextResponse.json(item, { status: 201 });
  });
}
