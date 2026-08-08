import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { getProductionOrder } from '@/domain/production-orders/order-queries';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const order = await getProductionOrder(actor, params.id);
    return NextResponse.json(order);
  });
}
