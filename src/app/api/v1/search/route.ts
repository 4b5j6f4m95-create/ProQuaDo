import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { searchTraceability } from '@/domain/dossier/search';

// docs/05: GET /search?q={query}&type=serial_number|order|document
const querySchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(['all', 'serial_number', 'order', 'document']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      q: searchParams.get('q') ?? '',
      type: searchParams.get('type') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    return NextResponse.json({ results: await searchTraceability({ actor, ...query }) });
  });
}
