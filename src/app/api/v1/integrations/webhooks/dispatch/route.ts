import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requirePermission } from '@/lib/authz/require-permission';
import { dispatchWebhooks } from '@/domain/integrations/webhook-delivery';

/**
 * Runs one dispatch pass: enumerate new outbox events into deliveries, then
 * attempt everything that is due.
 *
 * This endpoint exists because there is no worker process — ADR-007 keeps
 * queue infrastructure out of the MVP, and the notification trick of
 * dispatching when somebody reads a page does not work for a receiver that
 * is not a person. Something has to call this on a schedule; without that,
 * nothing is ever delivered. ADR-008 says so in the deployment consequences,
 * and notes.md repeats it.
 *
 * Behind `integration.manage` rather than a shared secret: the scheduler
 * authenticates as a service user like any other caller, so its actions are
 * attributable in the same audit trail as everything else, and revoking it
 * is the same operation as revoking a person.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requirePermission('integration.manage');
    return NextResponse.json(await dispatchWebhooks(actor));
  });
}
