import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { buildOfflineBundle } from '@/domain/sync/offline-bundle';

// "Für Offline vorbereiten": everything the tablet needs to work without a
// connection, including a release token for each step that is READY — and
// for no other step (see offline-bundle.ts).
const querySchema = z.object({ deviceId: z.string().uuid() });

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const { deviceId } = querySchema.parse({ deviceId: searchParams.get('deviceId') });

    return NextResponse.json(await buildOfflineBundle(actor, deviceId));
  });
}
