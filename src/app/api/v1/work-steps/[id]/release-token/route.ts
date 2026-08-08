import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { reissueReleaseTokenForDevice } from '@/domain/sync/offline-bundle';

/**
 * Hands a device the signed proof that THIS step was released, so it can
 * start the step while offline.
 *
 * Refused unless the step is already READY with a valid server release — the
 * endpoint mints proof of an existing release, it never creates one. A step
 * that is LOCKED has no token and cannot get one, which is the invariant
 * from docs/06 seen from the API side (Negativtest #1, #2).
 */
const bodySchema = z.object({ deviceId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { deviceId } = bodySchema.parse(await request.json());

    const token = await reissueReleaseTokenForDevice(actor, params.id, deviceId);
    return NextResponse.json({
      workStepInstanceId: params.id,
      releaseToken: token.encoded,
      validUntil: token.validUntil || null,
    });
  });
}
