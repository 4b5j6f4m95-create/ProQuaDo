import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { addInspectionCharacteristic } from '@/domain/production-plans/plan-step-requirements';

// Numeric fields are strings end to end — see the comment on
// AddInspectionCharacteristicCommand.
const decimalString = z.string().regex(/^-?\d+([.,]\d+)?$/, 'Ungültiger Zahlenwert'); // comma is normalized in parseDecimalInput()

const addCharacteristicSchema = z.object({
  characteristicNumber: z.number().int().positive(),
  name: z.string().min(1).max(255),
  nominalValue: decimalString.optional(),
  lowerLimit: decimalString.optional(),
  upperLimit: decimalString.optional(),
  unit: z.string().max(20).optional(),
  isRequired: z.boolean().optional(),
  requiresMeasuringEquipment: z.boolean().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string; stepId: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = addCharacteristicSchema.parse(await request.json());
    const characteristic = await addInspectionCharacteristic({
      actor,
      productionPlanRevisionId: params.id,
      planStepId: params.stepId,
      ...body,
    });
    return NextResponse.json(characteristic, { status: 201 });
  });
}
