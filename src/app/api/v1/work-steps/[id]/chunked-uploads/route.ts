import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { resolveDeviceId } from '@/lib/api/device-context';
import { beginChunkedPhotoUpload } from '@/domain/execution/photo-upload-chunks';

// Opens a resumable upload (docs/06 "Resumable Upload"). The device declares
// what it is going to send; the server verifies afterwards that it got
// exactly that.
const beginSchema = z.object({
  mimeType: z.string().min(1).max(255),
  totalBytes: z.number().int().positive(),
  chunkSizeBytes: z.number().int().positive(),
  expectedHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
  photoRequirementId: z.string().uuid().optional(),
  photoCategory: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  takenAt: z.coerce.date().optional(),
  deviceId: z.string().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = beginSchema.parse(await request.json());

    const state = await beginChunkedPhotoUpload({
      actor,
      workStepInstanceId: params.id,
      ...body,
      deviceId: await resolveDeviceId(actor, body.deviceId),
    });
    return NextResponse.json(state, { status: 201 });
  });
}
