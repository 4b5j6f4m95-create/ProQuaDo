import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { decideSyncConflict } from '@/domain/sync/decide-conflict';
import { DECISION_TYPES } from '@/domain/sync/conflict-types';

// docs/07 B4: decision, reason and PIN. All three are mandatory — a
// conflict decision without a recorded reason would be an unexplained change
// to a product's conformity record.
const decisionSchema = z.object({
  decision: z.enum(DECISION_TYPES),
  reason: z.string().min(1).max(4000),
  pin: z.string().min(4).max(32),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = decisionSchema.parse(await request.json());

    return NextResponse.json(await decideSyncConflict({ actor, conflictId: params.id, ...body }));
  });
}
