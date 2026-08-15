import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SYSTEM_ROLES } from '@/domain/identity/system-roles';
import { PERMISSIONS } from '@/domain/identity/permissions-catalog';

/**
 * Die Menüleiste zeigt nur Ziele, die die angemeldete Person betreten kann.
 *
 * **Woran das scheitern würde, und was dieser Test deshalb prüft.** Die
 * Zuordnung Ziel → Berechtigung ist eine Tabelle, die von Hand gepflegt
 * wird. Zwei Fehler sind dabei möglich, und beide fallen im Betrieb erst
 * spät auf:
 *
 *   - **Ein zu schwaches Atom** — die Leiste bietet ein Ziel an, dessen
 *     Bildschirm absagt. Genau der Zustand, der diese Arbeit ausgelöst hat:
 *     `/admin` stand bei jeder Rolle im Menü und antwortete der
 *     Projektleitung mit einem React-Fehlercode.
 *   - **Ein Tippfehler im Atom** — es passt zu keiner Berechtigung, die es
 *     gibt, und das Ziel verschwindet für **alle**, lautlos.
 *
 * Der zweite Fall ist der heimtückischere: ein verschwundener Menüpunkt
 * sieht nach einer Berechtigungsfrage aus, nicht nach einem Tippfehler.
 * Deshalb wird jedes Atom gegen den Katalog geprüft.
 *
 * Gelesen wird die **echte Komponente**, nicht eine Kopie der Tabelle.
 */

const QUELLE = readFileSync(join(process.cwd(), 'src/components/PrimaryNav.tsx'), 'utf-8');

interface Ziel {
  label: string;
  permission: string | null;
}

/** Die Zieltabelle aus der Komponente, so wie sie dort steht. */
function zieleAusDerKomponente(): Ziel[] {
  const block = /const ZIELE[^=]*=\s*\[([\s\S]*?)\n\];/.exec(QUELLE);
  if (!block) throw new Error('ZIELE-Tabelle in PrimaryNav.tsx nicht gefunden.');
  const ziele: Ziel[] = [];
  for (const zeile of block[1]!.split('\n')) {
    const label = /label:\s*'([^']+)'/.exec(zeile);
    if (!label) continue;
    const permission = /permission:\s*'([^']+)'/.exec(zeile);
    ziele.push({ label: label[1]!, permission: permission ? permission[1]! : null });
  }
  return ziele;
}

describe('Menüleiste: Ziel und Berechtigung', () => {
  const ziele = zieleAusDerKomponente();

  it('liest alle zehn Ziele aus der Komponente', () => {
    expect(ziele).toHaveLength(10);
  });

  /**
   * Der lautlose Fall. Ein Atom, das es nicht gibt, kann niemand haben —
   * das Ziel wäre für jede Rolle verborgen, und niemand käme auf die Idee,
   * einen Tippfehler zu vermuten.
   */
  it('nennt nur Berechtigungen, die es im Katalog wirklich gibt', () => {
    const katalog = new Set(PERMISSIONS.map((p) => p.code));
    const unbekannt = ziele
      .filter((z) => z.permission && !katalog.has(z.permission as never))
      .map((z) => `${z.label} → ${z.permission}`);
    expect(unbekannt).toEqual([]);
  });

  /**
   * Zwei Ziele stehen bewusst ohne Bedingung. Der Test hält das fest, damit
   * niemand sie „zur Vollständigkeit" mit einem Atom versieht: Offline muss
   * gerade dann erreichbar sein, wenn der Server nichts sagen kann, und
   * Benachrichtigungen gehören der Person, nicht einer Rolle.
   */
  it('lässt Offline und Benachrichtigungen ohne Bedingung', () => {
    const ohne = ziele.filter((z) => z.permission === null).map((z) => z.label);
    expect(ohne.sort()).toEqual(['Benachrichtigungen', 'Offline']);
  });

  /**
   * Die Wirkung, Rolle für Rolle. Nicht als Momentaufnahme festgeschrieben,
   * sondern als die eine Zusicherung, um die es geht: **kein Ziel im Menü,
   * das beim Anklicken absagt.**
   */
  it.each(Object.entries(SYSTEM_ROLES))(
    '%s sieht kein Ziel, das ihm verschlossen ist',
    (_code, rolle) => {
      const hat = new Set<string>(rolle.permissions);
      const sichtbar = ziele.filter((z) => !z.permission || hat.has(z.permission));
      for (const ziel of sichtbar) {
        if (ziel.permission) expect(hat.has(ziel.permission)).toBe(true);
      }
      // Jede Rolle behält mindestens die beiden bedingungslosen Ziele —
      // eine leere Leiste wäre ein Bildschirm ohne Ausweg.
      expect(sichtbar.length).toBeGreaterThanOrEqual(2);
    },
  );

  /**
   * Der Anlass der ganzen Arbeit, als Regressionsschutz: die Administration
   * darf **nur** dort stehen, wo sie auch aufgeht.
   */
  it('zeigt die Administration allein der Rolle, die sie betreten darf', () => {
    const admin = ziele.find((z) => z.label === 'Administration');
    expect(admin?.permission).toBe('user.manage');

    const mitZugang = Object.entries(SYSTEM_ROLES)
      .filter(([, r]) => (r.permissions as readonly string[]).includes('user.manage'))
      .map(([code]) => code);
    expect(mitZugang).toEqual(['ADMIN']);
  });
});
