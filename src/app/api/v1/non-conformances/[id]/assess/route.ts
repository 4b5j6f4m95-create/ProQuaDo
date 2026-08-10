import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assessNonConformance } from '@/domain/quality/ncr-workflow';

const assessSchema = z.object({
  assessmentNotes: z.string().min(1).max(4000),
  isBlocking: z.boolean().optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  errorCategory: z.string().max(50).optional(),
  assignedToId: z.string().uuid().optional(),
  dueDate: z.coerce.date().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = assessSchema.parse(await request.json());
    const ncr = await assessNonConformance({ actor, nonConformanceId: params.id, ...body });
    return NextResponse.json(ncr);
  });
}
