import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { transitionProductionOrderStatus } from '@/domain/production-orders/create-production-order';

// RELEASED is absent by design — releasing an order materializes work step
// instances and issues release tokens, so it has its own endpoint
// (POST /production-orders/{id}/release) rather than hiding behind a
// generic status change.
const transitionSchema = z.object({
  toStatus: z.enum([
    'PLANNED',
    'IN_PROGRESS',
    'PAUSED',
    'ON_HOLD',
    'QUALITY_BLOCKED',
    'COMPLETED',
    'CANCELLED',
    'ARCHIVED',
  ]),
  expectedVersion: z.number().int(),
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = transitionSchema.parse(await request.json());
    const order = await transitionProductionOrderStatus({
      actor,
      productionOrderId: params.id,
      ...body,
    });
    return NextResponse.json(order);
  });
}
