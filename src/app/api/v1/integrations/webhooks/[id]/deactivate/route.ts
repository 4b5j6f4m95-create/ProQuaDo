import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { deactivateWebhookSubscription } from '@/domain/integrations/webhook-subscriptions';

// Deactivation rather than deletion — the delivery history has to keep
// saying where data went. See webhook-subscriptions.ts.
const bodySchema = z.object({ reason: z.string().min(1).max(2000) });

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { reason } = bodySchema.parse(await request.json());
    await deactivateWebhookSubscription(actor, params.id, reason);
    return NextResponse.json({ id: params.id, isActive: false });
  });
}
