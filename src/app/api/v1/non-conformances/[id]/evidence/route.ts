import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { requestNcrEvidenceUploadUrl } from '@/domain/quality/ncr-evidence';

const uploadUrlSchema = z.object({
  mimeType: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = uploadUrlSchema.parse(await request.json());
    const result = await requestNcrEvidenceUploadUrl({
      actor,
      nonConformanceId: params.id,
      ...body,
    });
    return NextResponse.json(result);
  });
}
