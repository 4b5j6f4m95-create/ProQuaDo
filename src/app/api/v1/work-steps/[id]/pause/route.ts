import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { pauseWorkStep } from '@/domain/execution/start-work-step';

const pauseSchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = pauseSchema.parse(await request.json().catch(() => ({})));
    const instance = await pauseWorkStep({ actor, workStepInstanceId: params.id, ...body });
    return NextResponse.json(instance);
  });
}
