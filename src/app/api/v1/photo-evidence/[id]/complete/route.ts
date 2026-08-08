import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { completePhotoUpload } from '@/domain/execution/photo-evidence';
import { serializeBigInt } from '@/lib/api/serialize';

const completeSchema = z.object({
  expectedHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
  deviceId: z.string().max(255).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = completeSchema.parse(await request.json());
    const evidence = await completePhotoUpload({
      actor,
      photoEvidenceId: params.id,
      ...body,
    });
    return NextResponse.json(serializeBigInt(evidence));
  });
}
