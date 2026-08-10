import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assertWithinRateLimit } from '@/lib/api/rate-limit';
import { resolveDeviceId } from '@/lib/api/device-context';
import { requestPhotoUploadUrl } from '@/domain/execution/photo-evidence';

const uploadUrlSchema = z.object({
  mimeType: z.string().min(1).max(100),
  photoRequirementId: z.string().uuid().optional(),
  photoCategory: z.string().max(50).optional(),
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
    const body = uploadUrlSchema.parse(await request.json());
    // Erst verifizieren, dann zählen: ein Limit je Gerät ist keins, solange
    // der Zählschlüssel ein frei gewählter String des Aufrufers ist — siehe
    // resolveDeviceId.
    const deviceId = await resolveDeviceId(actor, body.deviceId);
    // docs/05: 20 Fotouploads pro Minute und Gerät.
    await assertWithinRateLimit('PHOTO_UPLOAD', { userId: actor.userId, deviceId });
    const result = await requestPhotoUploadUrl({
      actor,
      workStepInstanceId: params.id,
      ...body,
      deviceId,
    });
    return NextResponse.json(result);
  });
}
