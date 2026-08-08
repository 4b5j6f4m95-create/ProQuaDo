import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { getNonConformance } from '@/domain/quality/ncr-queries';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const ncr = await getNonConformance(actor, params.id);
    return NextResponse.json(ncr);
  });
}
