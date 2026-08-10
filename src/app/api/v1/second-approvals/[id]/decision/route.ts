import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { decideSecondApproval } from '@/domain/quality/second-approval';

// `id` is the work step instance — a step has at most one second approval,
// and addressing it by the step is what both the tablet and the QM view
// have at hand.
const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(2000).optional(),
  pin: z.string().min(4).max(12),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = decisionSchema.parse(await request.json());
    const result = await decideSecondApproval({
      actor,
      workStepInstanceId: params.id,
      ...body,
    });
    return NextResponse.json(result);
  });
}
