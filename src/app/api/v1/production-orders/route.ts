import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProductionOrder } from '@/domain/production-orders/create-production-order';
import { listProductionOrders } from '@/domain/production-orders/order-queries';

const createOrderSchema = z.object({
  projectId: z.string().uuid(),
  productId: z.string().uuid(),
  productionPlanRevisionId: z.string().uuid(),
  orderNumber: z.string().min(1).max(50),
  quantity: z.number().int().positive().optional(),
  batchNumber: z.string().max(50).optional(),
  serialNumber: z.string().max(50).optional(),
  plannedStartAt: z.coerce.date().optional(),
  plannedEndAt: z.coerce.date().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createOrderSchema.parse(await request.json());
    const order = await createProductionOrder({ actor, ...body });
    return NextResponse.json(order, { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const searchParams = new URL(request.url).searchParams;
    const orders = await listProductionOrders(actor, {
      projectId: searchParams.get('projectId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    });
    return NextResponse.json(orders);
  });
}
