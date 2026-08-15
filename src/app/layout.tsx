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
        {/* Das Band spannt über die volle Fensterbreite, sein Inhalt
            sitzt auf derselben Achse wie `main` — Entwurf 1e
            „Kontrollstand". */}
        <div className="nav-band">
          <nav>
            <Link href="/">ProQuaDo</Link>
            {/* **Eigener Behälter, damit die Leiste auf schmalen
                Bildschirmen eine Zeile bleibt.** Bei 768 px brachen elf
                Menüpunkte plus Sitzungsblock auf drei Zeilen um — auf
                dem dunklen Band ein Klotz, der ein Drittel des
                Hallentablets fraß. Hier scrollt die Reihe stattdessen
                waagrecht.

                **Kein Menüpunkt verschwindet dabei.** Der Entwurf 1d
                „Kiosk" zeigt eine Bottom-Bar mit vier Zielen; das ist
                ergonomisch besser, nimmt aber sieben Ziele weg. Wer am
                schmalen Fenster die Administration sucht, fände sie
                nicht mehr — und Tastatur wie Vorlesehilfe verlören sie
                ebenfalls. Waagrecht wischen ruiniert kein Handschuh;
                Zielen tut es. */}
            <div className="nav-links">
              <Link href="/dashboard">Übersicht</Link>
              <Link href="/projects">Projekte</Link>
              <Link href="/my-orders">Meine Aufträge</Link>
              <Link href="/quality/ncrs">Abweichungen</Link>
              <Link href="/quality/equipment">Prüfmittel</Link>
              <Link href="/offline">Offline</Link>
              <Link href="/sync/conflicts">Konflikte</Link>
              <Link href="/search">Suche</Link>
              <Link href="/notifications">Benachrichtigungen</Link>
              <Link href="/admin">Administration</Link>
            </div>

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
