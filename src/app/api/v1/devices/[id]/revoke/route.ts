import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { revokeDevice } from '@/domain/sync/device-registry';

// The remote-wipe lever from docs/06 "Geräteverlust und Sicherheit". Takes
// effect at the device's next sync health check.
const revokeSchema = z.object({ reason: z.string().min(1).max(1000) });

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = revokeSchema.parse(await request.json());

    await revokeDevice({ actor, deviceId: params.id, reason: body.reason });
    return NextResponse.json({ deviceId: params.id, isRevoked: true });
  });
}
