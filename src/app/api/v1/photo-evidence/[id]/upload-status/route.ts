import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { readUploadState } from '@/domain/execution/photo-upload-chunks';

// docs/06 `resumeUpload`: the client compares its own progress against what
// the server confirms and continues from `nextChunkIndex` — not from zero,
// and not from what the client believes it sent (Negativtest #14).
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    return NextResponse.json(await readUploadState(actor, params.id));
  });
}
