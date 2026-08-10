import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assertWithinRateLimit } from '@/lib/api/rate-limit';
import { requestDocumentUploadUrl } from '@/domain/documents/document-upload';

const requestUploadSchema = z.object({
  mimeType: z.string().min(1),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    // docs/05: 5 Dokumentuploads pro Minute und Benutzer.
    await assertWithinRateLimit('DOCUMENT_UPLOAD', { userId: actor.userId });
    const body = requestUploadSchema.parse(await request.json());
    const result = await requestDocumentUploadUrl({
      actor,
      documentRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(result);
  });
}
