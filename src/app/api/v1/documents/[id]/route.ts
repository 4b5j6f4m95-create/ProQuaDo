import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { getDocument } from '@/domain/documents/document-queries';
import { serializeBigInt } from '@/lib/api/serialize';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const document = await getDocument(actor, params.id);
    return NextResponse.json(serializeBigInt(document));
  });
}
