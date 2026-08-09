import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { resolveDeviceId } from '@/lib/api/device-context';
import { startWorkStep } from '@/domain/execution/start-work-step';

// releaseToken is optional: an online client has none (the server checks
// its own release record), an offline client presents the token it was
// given before losing connectivity. See StartWorkStepCommand.
//
// deviceId is optional but, when present, verified — a revoked tablet must
// not be able to start a step just because it still has a session
// (resolveDeviceId).
const startSchema = z.object({
  releaseToken: z.string().optional(),
  deviceId: z.string().optional(),
  clientTimestamp: z.coerce.date().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = startSchema.parse(await request.json().catch(() => ({})));
    const deviceId = await resolveDeviceId(actor, body.deviceId);
    const instance = await startWorkStep({
      actor,
      workStepInstanceId: params.id,
      ...body,
      deviceId,
    });
    return NextResponse.json({
      workStepInstanceId: instance.id,
      status: instance.status,
      startedAt: instance.startedAt,
      version: instance.version,
    });
  });
}
