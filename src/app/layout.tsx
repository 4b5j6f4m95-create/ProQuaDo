import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { signOutAction } from './auth-actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProQuaDo',
  description: 'Produktions-, Qualitäts- und Dokumentationssoftware',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="de">
      <body>
        <nav>
          <Link href="/">ProQuaDo</Link>
          <Link href="/dashboard">Übersicht</Link>
          <Link href="/projects">Projekte</Link>
          <Link href="/my-orders">Meine Aufträge</Link>
          <Link href="/quality/ncrs">Abweichungen</Link>
          <Link href="/quality/equipment">Prüfmittel</Link>
          <Link href="/offline">Offline</Link>
          <Link href="/sync/conflicts">Konflikte</Link>
          <Link href="/search">Suche</Link>
          <Link href="/notifications">Benachrichtigungen</Link>

          {/* Who is signed in, and how to stop being them. Both were missing
              until Phase 7: the application had no sign-out at all, so a
              shared tablet stayed logged in as whoever used it last and the
              audit trail attributed the next person's work to them. Naming
              the current user is half the fix — you cannot notice that you
              are somebody else if the screen never says who you are. */}
          {session?.user && (
            <form action={signOutAction} className="nav-session">
              <span className="muted">{session.user.displayName ?? session.user.email}</span>
              <button type="submit" className="link-button">
                Abmelden
              </button>
            </form>
          )}
        </nav>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
