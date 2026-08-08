import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { checkSyncHealth } from '@/domain/sync/sync-changes';

// docs/06 protocol steps 1–2: one authenticated round trip that answers
// "may this device still sync, and where does it stand". A revoked device
// gets DEVICE_REVOKED here, which is what triggers the local wipe.
const querySchema = z.object({ deviceId: z.string().uuid() });

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const { deviceId } = querySchema.parse({ deviceId: searchParams.get('deviceId') });

    return NextResponse.json(await checkSyncHealth(actor, deviceId));
  });
}
