import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  assignProductionOrder,
  revokeProductionOrderAssignment,
} from '@/domain/production-orders/assign-production-order';

const assignSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().max(50).optional(),
});

const revokeSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = assignSchema.parse(await request.json());
    const assignment = await assignProductionOrder({
      actor,
      productionOrderId: params.id,
      ...body,
    });
    return NextResponse.json(assignment, { status: 201 });
  });
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = revokeSchema.parse(await request.json());
    const assignment = await revokeProductionOrderAssignment({
      actor,
      productionOrderId: params.id,
      ...body,
    });
    return NextResponse.json(assignment);
  });
}
