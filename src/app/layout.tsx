import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProQuaDo',
  description: 'Produktions-, Qualitäts- und Dokumentationssoftware',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        </nav>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
