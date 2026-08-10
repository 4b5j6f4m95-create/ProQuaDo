import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { resumeWorkStep } from '@/domain/execution/start-work-step';

const resumeSchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = resumeSchema.parse(await request.json().catch(() => ({})));
    const instance = await resumeWorkStep({ actor, workStepInstanceId: params.id, ...body });
    return NextResponse.json(instance);
  });
}
