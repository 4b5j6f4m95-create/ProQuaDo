import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { resolveDeviceId } from '@/lib/api/device-context';
import { recordChecklistResponse } from '@/domain/execution/capture-evidence';

const responseSchema = z.object({
  checklistItemId: z.string().uuid(),
  response: z.enum(['OK', 'NOK', 'N/A']),
  comment: z.string().max(2000).optional(),
  deviceId: z.string().optional(),
  clientTimestamp: z.coerce.date().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = responseSchema.parse(await request.json());
    const saved = await recordChecklistResponse({
      actor,
      workStepInstanceId: params.id,
      ...body,
      deviceId: await resolveDeviceId(actor, body.deviceId),
    });
    return NextResponse.json(saved, { status: 201 });
  });
}
