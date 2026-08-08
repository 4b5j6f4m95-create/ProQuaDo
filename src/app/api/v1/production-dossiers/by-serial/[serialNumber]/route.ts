import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { findOrdersBySerialNumber } from '@/domain/dossier/search';

// docs/05: GET /production-dossiers/by-serial/{serialNumber}. Returns every
// order carrying the serial — see findOrdersBySerialNumber on why that is
// deliberately a list.
export async function GET(
  request: Request,
  { params }: { params: { serialNumber: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const orders = await findOrdersBySerialNumber(actor, decodeURIComponent(params.serialNumber));
    return NextResponse.json({ serialNumber: params.serialNumber, orders });
  });
}
