import { withOrgContext } from '@/lib/db/tenant-context';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { dispatchPendingNotifications } from './dispatch-notifications';

/**
 * Reading and acknowledging notifications.
 *
 * No permission atom guards these: a notification is addressed to one user by
 * id, and RLS plus the `userId` filter is the whole access rule. Adding a
 * permission would mean a person could be sent something they are not allowed
 * to read, which would be a bug in the fan-out, not something to enforce here.
 */

export interface NotificationView {
  id: string;
  eventType: string;
  title: string;
  body: string;
  severity: string;
  linkPath: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export async function listNotifications(
  actor: Actor,
  options: { includeRead?: boolean; limit?: number } = {},
): Promise<NotificationView[]> {
  // Dispatch on read — see dispatch-notifications.ts on why there is no
  // background worker.
  await dispatchPendingNotifications(actor.organizationId);

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  return withOrgContext(actor.organizationId, (tx) =>
    tx.notification.findMany({
      where: { userId: actor.userId, ...(options.includeRead ? {} : { readAt: null }) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        title: true,
        body: true,
        severity: true,
        linkPath: true,
        createdAt: true,
        readAt: true,
      },
    }),
  );
}

export async function countUnreadNotifications(actor: Actor): Promise<number> {
  return withOrgContext(actor.organizationId, (tx) =>
    tx.notification.count({ where: { userId: actor.userId, readAt: null } }),
  );
}

export async function markNotificationRead(actor: Actor, notificationId: string): Promise<void> {
  await withOrgContext(actor.organizationId, async (tx) => {
    // updateMany rather than update: scoping by userId in the WHERE clause
    // means another user's id simply matches nothing, instead of being read
    // first and rejected afterwards.
    const result = await tx.notification.updateMany({
      where: { id: notificationId, userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await tx.notification.findFirst({
        where: { id: notificationId, userId: actor.userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Benachrichtigung');
    }
  });
}

export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  const result = await withOrgContext(actor.organizationId, (tx) =>
    tx.notification.updateMany({
      where: { userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    }),
  );
  return result.count;
}
