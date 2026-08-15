import Link from 'next/link';

import type { PermissionCode } from '@/domain/identity/permissions-catalog';

/**
 * Die Ziele der Menüleiste — und wer sie sehen darf.
 *
 * **Das Atom ist nicht gewählt, sondern abgelesen.** Zu jedem Ziel steht
 * hier die Berechtigung, die der Bildschirm dahinter **tatsächlich**
 * verlangt: nachgeschlagen in der Abfrage, die er aufruft, nicht danach
 * geschätzt, was plausibel klingt. Wer hier etwas ändert, liest zuerst
 * nach, was der Bildschirm prüft — sonst zeigt die Leiste ein Ziel, das
 * beim Anklicken absagt, oder verbirgt eines, das offenstünde.
 *
 * Zwei Ziele stehen bewusst ohne Bedingung:
 *
 *   - **Benachrichtigungen** sind persönlich. Sie gehören der Person, nicht
 *     einer Rolle; `listNotifications` prüft deshalb auch nichts.
 *   - **Offline** ist der Arbeitsbereich des eigenen Geräts. Er lädt keine
 *     fremden Daten, sondern zeigt, was lokal liegt — und muss gerade dann
 *     erreichbar sein, wenn der Server keine Auskunft geben kann.
 */
const ZIELE: ReadonlyArray<{ href: string; label: string; permission?: PermissionCode }> = [
  { href: '/dashboard', label: 'Übersicht', permission: 'production_order.view' },
  { href: '/projects', label: 'Projekte', permission: 'project.view' },
  { href: '/my-orders', label: 'Meine Aufträge', permission: 'production_order.view' },
  { href: '/quality/ncrs', label: 'Abweichungen', permission: 'ncr.view' },
  { href: '/quality/equipment', label: 'Prüfmittel', permission: 'work_step.view' },
  { href: '/offline', label: 'Offline' },
  { href: '/sync/conflicts', label: 'Konflikte', permission: 'sync_conflict.view' },
  { href: '/search', label: 'Suche', permission: 'production_order.view' },
  { href: '/notifications', label: 'Benachrichtigungen' },
  { href: '/admin', label: 'Administration', permission: 'user.manage' },
];

/**
 * Zeigt nur die Ziele, die diese Person auch betreten kann.
 *
 * **Der Anlass war ein Absturz, keine Ästhetik.** Die Leiste bot jeder
 * Rolle alle zehn Ziele an; `/admin` beantwortete den Klick einer
 * Projektleitung mit „Minified React error #441". Die Absage
 * (`PermissionDenied`) macht das erträglich — aber ein Weg, der von
 * vornherein nicht offensteht, gehört nicht in die Wegweisung.
 *
 * **Verborgen, nicht ausgegraut.** Ein abgeschaltetes Ziel wirft dieselbe
 * Frage auf wie ein fehlendes („warum nicht?"), kostet aber Platz in einer
 * Leiste, die auf keinem Bildschirm in eine Zeile passt. Wer doch dorthin
 * gelangt — über ein Lesezeichen, einen weitergegebenen Link —, bekommt die
 * Absage mit dem Namen der fehlenden Berechtigung. Das ist die bessere
 * Auskunft als ein grauer Menüpunkt ohne Begründung.
 */
export function PrimaryNav({ permissions }: { permissions: ReadonlySet<PermissionCode> }) {
  const sichtbar = ZIELE.filter((ziel) => !ziel.permission || permissions.has(ziel.permission));

  return (
    <div className="nav-links">
      {sichtbar.map((ziel) => (
        <Link key={ziel.href} href={ziel.href}>
          {ziel.label}
        </Link>
      ))}
    </div>
  );
}
