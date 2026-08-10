import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { getCompletionSubmission } from '@/domain/execution/execution-queries';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const submission = await getCompletionSubmission(actor, params.id);
    return NextResponse.json(submission);
  });
}
