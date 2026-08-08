import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  listNotifications,
  markAllNotificationsRead,
} from '@/domain/notifications/notification-queries';

const querySchema = z.object({
  includeRead: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      includeRead: searchParams.get('includeRead') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    const notifications = await listNotifications(actor, {
      includeRead: query.includeRead === 'true',
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
    return NextResponse.json({ notifications });
  });
}

/** Mark everything read. Idempotent by nature — a second call finds nothing
 *  unread and reports zero. */
export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    return NextResponse.json({ markedRead: await markAllNotificationsRead(actor) });
  });
}
