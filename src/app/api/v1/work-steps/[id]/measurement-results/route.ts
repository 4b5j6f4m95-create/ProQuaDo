import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { recordMeasurementResult } from '@/domain/execution/capture-evidence';

const measurementSchema = z.object({
  inspectionCharacteristicId: z.string().uuid(),
  // String, not number: a measured value must reach the NUMERIC column
  // without passing through binary floating point.
  measuredValue: z.string().min(1).max(40),
  measuringEquipmentRef: z.string().max(100).optional(),
  deviceId: z.string().max(255).optional(),
  clientTimestamp: z.coerce.date().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = measurementSchema.parse(await request.json());
    const saved = await recordMeasurementResult({
      actor,
      workStepInstanceId: params.id,
      ...body,
    });
    return NextResponse.json(saved, { status: 201 });
  });
}
