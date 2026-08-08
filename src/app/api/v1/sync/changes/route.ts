import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { pullChanges } from '@/domain/sync/sync-changes';

// The cursor is a bigint over the wire as a decimal string: JSON numbers are
// doubles, and a stream position is exactly the kind of value that must not
// lose precision silently.
const querySchema = z.object({
  deviceId: z.string().uuid(),
  cursor: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v === undefined ? undefined : BigInt(v))),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      deviceId: searchParams.get('deviceId'),
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    return NextResponse.json(await pullChanges({ actor, ...query }));
  });
}
