import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  createMeasuringEquipment,
  listMeasuringEquipment,
} from '@/domain/quality/measuring-equipment';

const decimalString = z.string().regex(/^-?\d+([.,]\d+)?$/, 'Ungültiger Zahlenwert');

const createSchema = z.object({
  equipmentNumber: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  manufacturer: z.string().max(255).optional(),
  model: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  measurementRangeMin: decimalString.optional(),
  measurementRangeMax: decimalString.optional(),
  measurementUnit: z.string().max(20).optional(),
  location: z.string().max(255).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createSchema.parse(await request.json());
    const equipment = await createMeasuringEquipment({ actor, ...body });
    return NextResponse.json(equipment, { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    // The usability verdict is computed for a point in time; callers can
    // ask about the moment a past measurement was taken.
    const at = new URL(request.url).searchParams.get('at');
    const equipment = await listMeasuringEquipment(actor, at ? new Date(at) : new Date());
    return NextResponse.json(equipment);
  });
}
