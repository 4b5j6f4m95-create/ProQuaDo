import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assertWithinRateLimit } from '@/lib/api/rate-limit';
import { resolveDeviceId } from '@/lib/api/device-context';
import { uploadPhotoChunk } from '@/domain/execution/photo-upload-chunks';

/**
 * One chunk of a resumable upload. The body is the raw bytes; index and hash
 * travel in headers so the payload stays a plain binary stream the client can
 * slice straight off a File without re-encoding it.
 *
 * The chunk goes through the server rather than a presigned URL because the
 * server must hash what actually arrived — a PUT it never sees could not be
 * verified, and an unverified chunk is not evidence.
 */
const headerSchema = z.object({
  chunkIndex: z.coerce.number().int().nonnegative(),
  chunkHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
  deviceId: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const headers = headerSchema.parse({
      chunkIndex: request.headers.get('x-chunk-index'),
      chunkHashSha256: request.headers.get('x-chunk-hash'),
      deviceId: request.headers.get('x-device-id') ?? undefined,
    });

    // Der Header wird verifiziert, bevor er als Zählschlüssel dient: sonst
    // reicht ein neuer Zufallswert je Block, um am Limit vorbeizulaufen.
    const deviceId = await resolveDeviceId(actor, headers.deviceId);

    // Blöcke zählen wie Fotouploads: ein Gerät, das eine Datei in 1-MiB-Blöcken
    // sendet, darf dabei nicht am Fotolimit vorbeilaufen.
    assertWithinRateLimit('PHOTO_UPLOAD', { userId: actor.userId, deviceId });

    const chunk = new Uint8Array(await request.arrayBuffer());

    const state = await uploadPhotoChunk({
      actor,
      photoEvidenceId: params.id,
      chunk,
      ...headers,
      deviceId,
    });
    return NextResponse.json(state);
  });
}
