import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { validateCompletionSubmission } from '@/domain/execution/complete-work-step';

/**
 * Manual (re-)validation by a QM/PL — `completion_submission.validate` in
 * docs/04. The normal online path validates automatically inside the
 * submission itself; this endpoint exists for submissions left pending,
 * e.g. because a hold blocked them at the time (and, from Phase 5 on, for
 * conflicted offline submissions).
 */
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const result = await validateCompletionSubmission({
      actor,
      completionSubmissionId: params.id,
    });
    return NextResponse.json(result);
  });
}
