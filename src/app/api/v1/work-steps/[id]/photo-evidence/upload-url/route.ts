import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assertWithinRateLimit } from '@/lib/api/rate-limit';
import { requestPhotoUploadUrl } from '@/domain/execution/photo-evidence';

const uploadUrlSchema = z.object({
  mimeType: z.string().min(1).max(100),
  photoRequirementId: z.string().uuid().optional(),
  photoCategory: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
  takenAt: z.coerce.date().optional(),
  deviceId: z.string().max(255).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = uploadUrlSchema.parse(await request.json());
    // docs/05: 20 Fotouploads pro Minute und Gerät.
    assertWithinRateLimit('PHOTO_UPLOAD', { userId: actor.userId, deviceId: body.deviceId });
    const result = await requestPhotoUploadUrl({
      actor,
      workStepInstanceId: params.id,
      ...body,
    });
    return NextResponse.json(result);
  });
}
