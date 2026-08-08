import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { markNotificationRead } from '@/domain/notifications/notification-queries';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    await markNotificationRead(actor, params.id);
    return NextResponse.json({ notificationId: params.id, read: true });
  });
}
