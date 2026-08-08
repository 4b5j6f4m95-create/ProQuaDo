import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { recordCalibration } from '@/domain/quality/measuring-equipment';

const calibrationSchema = z.object({
  calibratedAt: z.coerce.date(),
  nextCalibrationDueAt: z.coerce.date(),
  calibratedBy: z.string().max(255).optional(),
  calibrationCertificateKey: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = calibrationSchema.parse(await request.json());
    const calibration = await recordCalibration({
      actor,
      measuringEquipmentId: params.id,
      ...body,
    });
    return NextResponse.json(calibration, { status: 201 });
  });
}
