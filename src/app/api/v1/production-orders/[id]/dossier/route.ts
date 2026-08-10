import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assembleProductionDossier } from '@/domain/dossier/assemble-dossier';

// The assembled dossier as data — the same content the PDF renders, for a
// caller that wants to read rather than print it (docs/05
// GET /production-dossiers/...). Derived from the primary records on every
// call; see assemble-dossier.ts on why it is never a stored snapshot.
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    return NextResponse.json(await assembleProductionDossier(actor, params.id));
  });
}
