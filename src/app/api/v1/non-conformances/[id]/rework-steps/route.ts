import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createReworkStep } from '@/domain/quality/ncr-workflow';

/** Creates the rework step for this NCR — a new work step instance linked
 *  to the failed original, released READY with its own token. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const result = await createReworkStep({ actor, nonConformanceId: params.id });
    return NextResponse.json(result, { status: 201 });
  });
}
