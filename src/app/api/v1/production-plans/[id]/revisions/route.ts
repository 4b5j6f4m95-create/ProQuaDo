import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProductionPlanRevision } from '@/domain/production-plans/create-production-plan';

const createRevisionSchema = z.object({ changeReason: z.string().min(1) });

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createRevisionSchema.parse(await request.json());
    const revision = await createProductionPlanRevision({
      actor,
      productionPlanId: params.id,
      ...body,
    });
    return NextResponse.json(revision, { status: 201 });
  });
}
