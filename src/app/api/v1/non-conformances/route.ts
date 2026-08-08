import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { raiseNonConformance } from '@/domain/quality/raise-non-conformance';
import { listNonConformances } from '@/domain/quality/ncr-queries';

const raiseSchema = z.object({
  productionOrderId: z.string().uuid(),
  workStepInstanceId: z.string().uuid().optional(),
  description: z.string().min(1).max(4000),
  errorCategory: z.string().max(50).optional(),
  discoveredLocation: z.string().max(255).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  // The client may only ever RAISE the classification; the server decides
  // the rest (see classifyBlocking).
  reporterSuggestsBlocking: z.boolean().optional(),
  discoveredAt: z.coerce.date().optional(),
  deviceId: z.string().max(255).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = raiseSchema.parse(await request.json());
    const ncr = await raiseNonConformance({ actor, ...body });
    return NextResponse.json(ncr, { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const params = new URL(request.url).searchParams;
    const ncrs = await listNonConformances(actor, {
      productionOrderId: params.get('productionOrderId') ?? undefined,
      status: params.get('status') ?? undefined,
      openOnly: params.get('openOnly') === 'true',
      blockingOnly: params.get('blockingOnly') === 'true',
    });
    return NextResponse.json(ncrs);
  });
}
