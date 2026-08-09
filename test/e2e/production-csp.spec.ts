import { test, expect } from './support/test';

/**
 * Belegt, dass dieser Lauf wirklich gegen einen Production-Build fährt — und
 * damit, dass alle übrigen E2E-Tests unter der CSP stattfinden.
 *
 * Ohne diesen Test wäre "wir prüfen gegen Production" eine Behauptung in einem
 * Kommentar. Genau so eine Behauptung hat die Anwendung sieben Phasen lang
 * ungeprüft in Produktion geschickt (notes.md, "Dieselbe CSP verhinderte in
 * Production jede Hydration"): eine Absicherung, die in der gesamten Prüfkette
 * abgeschaltet ist, ist ungeprüft, egal wie grün die Kette aussieht.
 *
 * Der zweite Teil ist der eigentliche Fallstrick von damals: die Nonce muss auf
 * den **Request**-Headern stehen, sonst stempelt Next.js seine eigenen Skripte
 * nicht. Steht sie nur auf der Antwort, sieht der Header genauso richtig aus —
 * und die Seite hydriert trotzdem nicht. Der Vergleich unten würde das finden.
 */

test('Der ausgelieferte Build steht unter der Nonce-CSP, und die Nonce erreicht die Skripte', async ({
  request,
}) => {
  const response = await request.get('/login');
  expect(response.status()).toBe(200);

  const csp = response.headers()['content-security-policy'];
  expect(csp, 'Keine CSP — läuft der Server im Development-Modus?').toBeTruthy();

  const nonce = /script-src [^;]*'nonce-([^']+)'/.exec(csp!)?.[1];
  expect(nonce, `script-src ohne Nonce: ${csp}`).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp, "script-src darf 'unsafe-inline' nicht enthalten").not.toMatch(
    /script-src [^;]*'unsafe-inline'/,
  );

  const html = await response.text();
  expect(html, 'Next.js hat seine Skripte nicht mit der Nonce gestempelt').toContain(
    `nonce="${nonce}"`,
  );
});
