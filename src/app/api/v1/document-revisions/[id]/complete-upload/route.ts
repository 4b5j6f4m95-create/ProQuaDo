import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { completeDocumentUpload } from '@/domain/documents/document-upload';
import { serializeBigInt } from '@/lib/api/serialize';

const completeUploadSchema = z.object({
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  expectedHashSha256: z.string().length(64),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = completeUploadSchema.parse(await request.json());
    const revision = await completeDocumentUpload({
      actor,
      documentRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(serializeBigInt(revision));
  });
}
