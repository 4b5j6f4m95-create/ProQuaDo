import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createReinspectionStep } from '@/domain/quality/ncr-workflow';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const result = await createReinspectionStep({ actor, nonConformanceId: params.id });
    return NextResponse.json(result, { status: 201 });
  });
}
