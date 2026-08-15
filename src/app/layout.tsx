import type { Metadata } from 'next';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { listPermissions } from '@/lib/authz/can';
import { PrimaryNav } from '@/components/PrimaryNav';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { signOutAction } from './auth-actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProQuaDo',
  description: 'Produktions-, Qualitäts- und Dokumentationssoftware',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Ohne Sitzung gibt es keine Leiste zu füllen — und keinen Grund, die
  // Datenbank danach zu fragen.
  const permissions = session?.user
    ? await listPermissions(session.user.id, session.user.organizationId)
    : new Set<PermissionCode>();

  return (
    <html lang="de">
      <body>
        {/* Das Band spannt über die volle Fensterbreite, sein Inhalt
            sitzt auf derselben Achse wie `main` — Entwurf 1e
            „Kontrollstand". */}
        <div className="nav-band">
          <nav>
            <Link href="/">ProQuaDo</Link>
            {/* Nur die Ziele, die diese Person betreten kann — siehe
                PrimaryNav. Die Berechtigungen kommen in **einer** Abfrage
                (`listPermissions`), nicht in zehn: die Leiste steht auf
                jedem Bildschirm, und zehn Transaktionen je Seitenaufruf
                wären ein Preis, den man nicht nebenbei bezahlt. */}
            <PrimaryNav permissions={permissions} />

            {/* Who is signed in, and how to stop being them. Both were missing
                until Phase 7: the application had no sign-out at all, so a
                shared tablet stayed logged in as whoever used it last and the
                audit trail attributed the next person's work to them. Naming
                the current user is half the fix — you cannot notice that you
                are somebody else if the screen never says who you are. */}
            {session?.user && (
              <form action={signOutAction} className="nav-session">
                {/* Der Sync-Stand bleibt dauerhaft im Blick — im Entwurf 1e
                    „Kontrollstand" die einzige Auskunft, die das tut. Auf
                    einem Hallentablet ist es die Frage, die zuerst gestellt
                    wird: ist meine Arbeit schon drüben? Der Punkt allein
                    sagt es nicht, deshalb steht das Wort daneben. */}
                <span className="nav-sync">Online</span>

                {/* Der Name führt zum eigenen Konto — dort wird die
                    Bestätigungs-PIN gesetzt. Ohne sie lässt sich kein Schritt
                    abschließen, ein frisch angelegtes Konto muss also hier
                    vorbei, bevor es arbeiten kann. */}
                <Link href="/account" className="muted">
                  {session.user.displayName ?? session.user.email}
                </Link>
                <button type="submit" className="link-button">
                  Abmelden
                </button>
              </form>
            )}
          </nav>
        </div>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
