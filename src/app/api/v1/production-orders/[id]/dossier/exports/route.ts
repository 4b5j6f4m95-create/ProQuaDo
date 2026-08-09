import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assertWithinRateLimit } from '@/lib/api/rate-limit';
import { exportProductionDossier, listDossierExports } from '@/domain/dossier/export-dossier';

const exportSchema = z.object({ format: z.enum(['PDF', 'ZIP']) });

/**
 * Creates an export and returns it complete — generation is synchronous
 * behind a job record (ADR-007). The response carries the manifest and a
 * short-lived signed download URL; the archive itself is served from object
 * storage, not proxied through this route.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { format } = exportSchema.parse(await request.json());
    // docs/05: 5 Exporte pro Stunde und Benutzer. ADR-007 beruft sich darauf,
    // dass ein synchroner Export begrenzt bleibt — hier ist die Grenze.
    await assertWithinRateLimit('EXPORT', { userId: actor.userId });

    const result = await exportProductionDossier({
      actor,
      productionOrderId: params.id,
      format,
    });
    return NextResponse.json(result, { status: 201 });
  });
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    return NextResponse.json({ exports: await listDossierExports(actor, params.id) });
  });
}
