import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { listNotifications } from '@/domain/notifications/notification-queries';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/production-orders/[id]/dossier/actions';

const SEVERITY_ICON: Record<string, string> = {
  INFO: 'ℹ',
  WARNING: '⚠',
  CRITICAL: '⛔',
};

/** In-App-Benachrichtigungen. Fan-out aus dem Outbox-Strom passiert beim
 *  Lesen — siehe dispatch-notifications.ts. */
export default async function NotificationsPage(props: {
  searchParams: Promise<{ all?: string }>;
}) {
  const searchParams = await props.searchParams;
  const actor = await requirePageAuth();
  const includeRead = searchParams.all === '1';
  const notifications = await listNotifications(actor, { includeRead });

  return (
    <main>
      <h1>Benachrichtigungen</h1>

      <p className="actions">
        <Link className="button-link" href="/notifications">
          Ungelesen
        </Link>
        <Link className="button-link" href="/notifications?all=1">
          Alle
        </Link>
      </p>

      {notifications.length === 0 ? (
        <p className="notice">
          {includeRead ? 'Keine Benachrichtigungen.' : 'Keine ungelesenen Benachrichtigungen.'}
        </p>
      ) : (
        <>
          <form action={markAllNotificationsReadAction}>
            <button type="submit" className="touch-target">
              Alle als gelesen markieren
            </button>
          </form>

          {notifications.map((notification) => (
            <section
              key={notification.id}
              className={`card${notification.severity === 'CRITICAL' ? ' blocked-card' : ''}`}
            >
              <p>
                <strong>
                  {SEVERITY_ICON[notification.severity] ?? ''} {notification.title}
                </strong>
                {notification.readAt && <span className="status-chip">gelesen</span>}
              </p>
              <p>{notification.body}</p>
              <p className="muted">{notification.createdAt.toLocaleString('de-DE')}</p>
              <div className="actions">
                {notification.linkPath && (
                  <Link className="button-link" href={notification.linkPath}>
                    Öffnen →
                  </Link>
                )}
                {!notification.readAt && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="notificationId" value={notification.id} />
                    <button type="submit" className="touch-target">
                      Als gelesen markieren
                    </button>
                  </form>
                )}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
