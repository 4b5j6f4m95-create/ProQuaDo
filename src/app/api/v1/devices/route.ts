import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { listDevicesOfActor, registerDevice } from '@/domain/sync/device-registry';

// The device id is issued here, by the server, and stored by the client.
// See device-registry.ts for why a client-proposed id would be a way to
// adopt another tablet's sync identity.
const registerSchema = z.object({ deviceLabel: z.string().max(255).optional() });

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = registerSchema.parse(await request.json().catch(() => ({})));

    return NextResponse.json(await registerDevice({ actor, ...body }), { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    return NextResponse.json({ devices: await listDevicesOfActor(actor) });
  });
}
