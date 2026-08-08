import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createDocument } from '@/domain/documents/create-document';
import { listDocuments } from '@/domain/documents/document-queries';
import { serializeBigInt } from '@/lib/api/serialize';

const createDocumentSchema = z.object({
  projectId: z.string().uuid(),
  documentNumber: z.string().min(1).max(50),
  title: z.string().min(1).max(255),
  category: z.string().max(50).optional(),
  department: z.string().max(50).optional(),
  firstRevision: z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
  }),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createDocumentSchema.parse(await request.json());
    const result = await createDocument({ actor, ...body });
    return NextResponse.json(serializeBigInt(result), { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const projectId = new URL(request.url).searchParams.get('projectId') ?? undefined;
    const documents = await listDocuments(actor, { projectId });
    return NextResponse.json(serializeBigInt(documents));
  });
}
