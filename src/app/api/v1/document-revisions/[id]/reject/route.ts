import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { rejectDocumentRevision } from '@/domain/documents/document-review-workflow';
import { serializeBigInt } from '@/lib/api/serialize';

const rejectSchema = z.object({ reason: z.string().min(1) });

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = rejectSchema.parse(await request.json());
    const revision = await rejectDocumentRevision({
      actor,
      documentRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(serializeBigInt(revision));
  });
}
