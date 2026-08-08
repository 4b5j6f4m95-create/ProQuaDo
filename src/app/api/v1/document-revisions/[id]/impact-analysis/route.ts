import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { analyzeDocumentRevisionImpact } from '@/domain/quality/revision-impact';

/**
 * Which running orders execute against this revision — the analysis a
 * project lead sees before releasing its successor (docs/07 B2). Read-only:
 * recording a per-order decision is Phase 5's conflict handling.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const report = await analyzeDocumentRevisionImpact(actor, params.id);
    return NextResponse.json(report);
  });
}
