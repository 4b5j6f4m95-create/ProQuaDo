import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createDocumentRevision } from '@/domain/documents/create-document';
import { serializeBigInt } from '@/lib/api/serialize';

const createRevisionSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  changeReason: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createRevisionSchema.parse(await request.json());
    const revision = await createDocumentRevision({ actor, documentId: params.id, ...body });
    return NextResponse.json(serializeBigInt(revision), { status: 201 });
  });
}
