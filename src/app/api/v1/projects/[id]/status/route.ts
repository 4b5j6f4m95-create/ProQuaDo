import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { transitionProjectStatus } from '@/domain/projects/update-project';

const transitionSchema = z.object({
  toStatus: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  expectedVersion: z.number().int(),
  reason: z.string().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = transitionSchema.parse(await request.json());
    const project = await transitionProjectStatus({ actor, projectId: params.id, ...body });
    return NextResponse.json(project);
  });
}
