import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { listSyncConflicts } from '@/domain/sync/conflicts';

const querySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'ALL']).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const { status } = querySchema.parse({ status: searchParams.get('status') ?? undefined });

    return NextResponse.json({ conflicts: await listSyncConflicts(actor, { status }) });
  });
}
