import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { processSyncCommands } from '@/domain/sync/sync-commands';
import { syncCommandsRequestSchema } from '@/domain/sync/sync-command-types';

/**
 * `POST /api/v1/sync/commands` — docs/05 "Sync Commands (Client → Server,
 * Batch)".
 *
 * Always 200 when the batch itself was accepted, even if every command in it
 * conflicted: the per-command results carry the outcomes. An HTTP error here
 * would mean "the batch could not be read", and a client that retried on a
 * 4xx would resend commands that were in fact processed. The idempotency
 * keys would save it, but the response shape should not require that.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = syncCommandsRequestSchema.parse(await request.json());

    const results = await processSyncCommands({
      actor,
      deviceId: body.deviceId,
      commands: body.commands,
    });

    return NextResponse.json({ results });
  });
}
