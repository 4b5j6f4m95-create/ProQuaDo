import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { startWorkStep } from '@/domain/execution/start-work-step';

// releaseToken is optional: an online client has none (the server checks
// its own release record), an offline client presents the token it was
// given before losing connectivity. See StartWorkStepCommand.
const startSchema = z.object({
  releaseToken: z.string().optional(),
  deviceId: z.string().max(255).optional(),
  clientTimestamp: z.coerce.date().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = startSchema.parse(await request.json().catch(() => ({})));
    const instance = await startWorkStep({ actor, workStepInstanceId: params.id, ...body });
    return NextResponse.json({
      workStepInstanceId: instance.id,
      status: instance.status,
      startedAt: instance.startedAt,
      version: instance.version,
    });
  });
}
