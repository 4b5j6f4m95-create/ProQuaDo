import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { releaseDocumentRevision } from '@/domain/documents/document-review-workflow';
import { serializeBigInt } from '@/lib/api/serialize';

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const revision = await releaseDocumentRevision({ actor, documentRevisionId: params.id });
    return NextResponse.json(serializeBigInt(revision));
  });
}
