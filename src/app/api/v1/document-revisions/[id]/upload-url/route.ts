import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { requestDocumentUploadUrl } from '@/domain/documents/document-upload';

const requestUploadSchema = z.object({
  mimeType: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = requestUploadSchema.parse(await request.json());
    const result = await requestDocumentUploadUrl({
      actor,
      documentRevisionId: params.id,
      ...body,
    });
    return NextResponse.json(result);
  });
}
