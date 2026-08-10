import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { resolveDeviceId } from '@/lib/api/device-context';
import { finishChunkedPhotoUpload } from '@/domain/execution/photo-upload-chunks';

// Assembles the chunks and verifies the whole file server-side. The declared
// hash is checked, never trusted (Negativtest #7); re-finishing an already
// completed upload is a no-op (Negativtest #14).
const finishSchema = z.object({
  expectedHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
  deviceId: z.string().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = finishSchema.parse(await request.json());

    const evidence = await finishChunkedPhotoUpload({
      actor,
      photoEvidenceId: params.id,
      ...body,
      deviceId: await resolveDeviceId(actor, body.deviceId),
    });

    return NextResponse.json({
      photoEvidenceId: evidence.id,
      uploadStatus: evidence.uploadStatus,
      fileHashSha256: evidence.fileHashSha256,
      malwareScanStatus: evidence.malwareScanStatus,
    });
  });
}
