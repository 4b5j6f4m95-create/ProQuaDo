import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { assignProjectMember } from '@/domain/projects/assign-project-member';

const assignSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = assignSchema.parse(await request.json());
    const member = await assignProjectMember({ actor, projectId: params.id, ...body });
    return NextResponse.json(member, { status: 201 });
  });
}
