import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
} from '@/domain/integrations/webhook-subscriptions';
import { serializeBigInt } from '@/lib/api/serialize';

/**
 * Registering outbound endpoints — docs/10 Phase 6 "ERP/Webhook".
 *
 * `eventTypes` has no default. An empty array means "every event type", and
 * that has to be typed out: a webhook is where this organization's
 * production data leaves the building, and the difference between "the two
 * events the ERP needs" and "everything" should never be a forgotten field.
 */
const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().max(2000),
  eventTypes: z.array(z.string().max(100)).max(50),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createSchema.parse(await request.json());
    const created = await createWebhookSubscription({ actor, ...body });

    // 201 with the secret in the body — the only time it is ever returned.
    return NextResponse.json(created, { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const subscriptions = await listWebhookSubscriptions(actor);
    return NextResponse.json({ subscriptions: serializeBigInt(subscriptions) });
  });
}
