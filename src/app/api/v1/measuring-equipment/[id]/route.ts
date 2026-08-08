import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  getMeasuringEquipment,
  setMeasuringEquipmentStatus,
} from '@/domain/quality/measuring-equipment';

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED']),
  reason: z.string().max(500).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const equipment = await getMeasuringEquipment(actor, params.id);
    return NextResponse.json(equipment);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = statusSchema.parse(await request.json());
    const equipment = await setMeasuringEquipmentStatus({
      actor,
      measuringEquipmentId: params.id,
      ...body,
    });
    return NextResponse.json(equipment);
  });
}
