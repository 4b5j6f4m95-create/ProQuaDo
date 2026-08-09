import { test as base, expect } from '@playwright/test';

/**
 * Playwright-Basistest mit einer zusätzlichen, immer aktiven Zusicherung: die
 * Seite darf während des Tests weder die CSP verletzen noch die Hydration
 * abbrechen.
 *
 * Der Grund steht in notes.md unter "Dieselbe CSP verhinderte in Production
 * jede Hydration": `script-src 'self'` blockierte im Production-Build die
 * Inline-Skripte, die den RSC-Payload und den Hydrations-Bootstrap tragen.
 * Kein Client-Element funktionierte mehr — sichtbar war das ausschließlich in
 * der Browserkonsole, als Wand aus CSP-Verstößen und React-Fehler #423.
 *
 * Deshalb wird hier nicht auf beliebige Konsolenfehler geprüft (ein 404 auf
 * ein Favicon ist keiner), sondern auf genau die Muster, an denen dieser
 * Fehler zu erkennen war — plus jede unbehandelte Ausnahme der Seite.
 */

const BLOCKING_PATTERNS = [
  /Content Security Policy/i,
  /Minified React error/i,
  /hydrat/i, // "Hydration failed", "There was an error while hydrating"
];

export const test = base.extend<{ failOnClientErrors: void }>({
  failOnClientErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];

      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (BLOCKING_PATTERNS.some((pattern) => pattern.test(text))) {
          problems.push(`console: ${text}`);
        }
      });
      page.on('pageerror', (error) => {
        problems.push(`pageerror: ${error.message}`);
      });

      await use();

      expect(problems, 'CSP-Verstöße, React-Fehler oder unbehandelte Ausnahmen im Browser').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
