import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { resolveDeviceId } from '@/lib/api/device-context';
import { submitWorkStepCompletion } from '@/domain/execution/complete-work-step';

const submissionSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  clientCompletedAt: z.coerce.date().optional(),
  // Verified, not just accepted — the value is written to
  // completion_submissions.device_id and step_confirmations.device_id, which
  // is an audit statement about who confirmed the step and from where.
  deviceId: z.string().optional(),
  usedDocumentRevisionIds: z.array(z.string().uuid()).optional(),
  confirmation: z.object({
    signatureMethod: z.enum(['PIN', 'DIGITAL_SIGNATURE']),
    pin: z.string().min(4).max(12),
  }),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = submissionSchema.parse(await request.json());

    // Header wins over body — docs/05 defines Idempotency-Key as a header;
    // the body field exists so the Phase 5 sync batch can carry one key per
    // command inside a single HTTP request.
    const idempotencyKey =
      request.headers.get('idempotency-key') ?? body.idempotencyKey ?? undefined;
    if (!idempotencyKey) {
      return NextResponse.json(
        {
          type: '/errors/validation-failed',
          title: 'VALIDATION_ERROR',
          status: 422,
          code: 'VALIDATION_ERROR',
          detail: 'Idempotency-Key ist für Abschlussmeldungen verpflichtend.',
          instance: new URL(request.url).pathname,
          correlationId: request.headers.get('x-correlation-id') ?? '',
        },
        { status: 422 },
      );
    }

    const result = await submitWorkStepCompletion({
      actor,
      workStepInstanceId: params.id,
      idempotencyKey,
      confirmation: body.confirmation,
      clientCompletedAt: body.clientCompletedAt,
      deviceId: await resolveDeviceId(actor, body.deviceId),
      usedDocumentRevisionIds: body.usedDocumentRevisionIds,
    });

    // 200 even when result is REJECTED: the submission was accepted and
    // processed — what failed is the step's validation, and that verdict is
    // the payload (docs/05 CompletionSubmissionResponse carries `status`
    // plus `validationErrors` in one response). Clients must read `result`,
    // never infer completion from the HTTP status alone.
    return NextResponse.json(result);
  });
}
