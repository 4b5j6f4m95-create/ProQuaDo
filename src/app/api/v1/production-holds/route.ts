import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { applyProductionHold, listProductionHolds } from '@/domain/quality/production-holds';

const applySchema = z.object({
  scopeType: z.enum(['PROJECT', 'ORDER', 'SERIAL', 'WORK_STEP']),
  projectId: z.string().uuid().optional(),
  productionOrderId: z.string().uuid().optional(),
  serialNumber: z.string().max(50).optional(),
  workStepInstanceId: z.string().uuid().optional(),
  nonConformanceId: z.string().uuid().optional(),
  holdReason: z.string().min(1).max(500),
  releaseCondition: z.string().max(500).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = applySchema.parse(await request.json());
    const hold = await applyProductionHold({ actor, ...body });
    return NextResponse.json(hold, { status: 201 });
  });
}

// GET /production-holds?scope=order&scopeId={orderId} — the shape from
// docs/05_API_CONTRACTS.md "Production Hold".
export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const params = new URL(request.url).searchParams;
    const scope = params.get('scope');
    const holds = await listProductionHolds(actor, {
      productionOrderId: scope === 'order' ? (params.get('scopeId') ?? undefined) : undefined,
      activeOnly: params.get('activeOnly') !== 'false',
    });
    return NextResponse.json(holds);
  });
}
