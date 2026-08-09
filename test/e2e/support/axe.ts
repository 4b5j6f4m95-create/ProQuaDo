import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Ebene 9 aus docs/09_TEST_PYRAMID.md, und die „Definition of Done" verlangt
 * sie für jeden Feature-Schnitt: „Accessibility Check (axe-core) ohne
 * Violations".
 *
 * **Zur Tagmenge:** docs/09 nennt nur `wcag22aa`. Dieses Tag steht in axe-core
 * ausschließlich für die *in WCAG 2.2 neu hinzugekommenen* Kriterien — allein
 * geprüft, liefe der Test an Kontrast, Formularbeschriftung und Namen von
 * Bedienelementen vorbei, also an praktisch allem, was in dieser Anwendung
 * schiefgehen kann. Geprüft wird deshalb die kumulative Menge bis AA. Das ist
 * strenger als der Buchstabe von docs/09 und trifft, was dort gemeint ist.
 *
 * **Was ein grüner Lauf nicht heißt:** axe findet maschinell Prüfbares, nach
 * gängiger Schätzung einen Teil der Barrieren. Ob ein Mitarbeiter mit
 * Handschuhen die Bestätigungs-PIN am Tablet bedienen kann, sagt kein
 * automatischer Test. Ebene 9 ersetzt keine Prüfung mit echten Hilfsmitteln —
 * sie hält die Regressionen fern, die sich automatisch feststellen lassen.
 */

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export interface AxeScanOptions {
  /**
   * Regeln, die auf dieser Seite bewusst nicht gelten sollen — nur mit
   * Begründung im Aufrufer. Eine stillschweigende Ausnahme wäre ein grüner
   * Test über einer bekannten Barriere.
   */
  disableRules?: string[];
}

/**
 * Prüft die aktuelle Seite und meldet Verstöße so, dass die Fehlermeldung
 * allein zum Beheben reicht: Regel, Schweregrad, betroffene Elemente und der
 * Verweis auf die Regelbeschreibung.
 */
export async function expectNoAccessibilityViolations(
  page: Page,
  label: string,
  options: AxeScanOptions = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_AA_TAGS);
  if (options.disableRules?.length) {
    builder = builder.disableRules(options.disableRules);
  }

  const results = await builder.analyze();

  // Ein Scan ohne Verstöße und ohne bestandene Regeln ist kein Ergebnis,
  // sondern eine leere Seite: eine fehlgeschlagene Navigation liefert
  // `about:blank`, und darauf hat axe nichts zu beanstanden. Auf den Seiten
  // dieser Anwendung laufen rund zwanzig Regeln durch (nachgemessen), die
  // Untergrenze ist also großzügig.
  expect(
    results.passes.length,
    `Barrierefreiheit: ${label} — axe hat keine einzige Regel ausgewertet, die Seite war vermutlich leer`,
  ).toBeGreaterThan(0);

  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    elements: violation.nodes.map((node) => node.target.join(' ')),
  }));

  expect(summary, `Barrierefreiheit: ${label}`).toEqual([]);
}
