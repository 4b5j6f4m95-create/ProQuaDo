import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { approveDocumentRevision } from '@/domain/documents/document-review-workflow';
import { serializeBigInt } from '@/lib/api/serialize';

const approveSchema = z.object({ reason: z.string().optional() });

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = approveSchema.parse(await request.json().catch(() => ({})));
    const revision = await approveDocumentRevision({
      actor,
      documentRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(serializeBigInt(revision));
  });
}
