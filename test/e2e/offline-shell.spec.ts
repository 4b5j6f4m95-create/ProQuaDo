import { test, expect } from './support/test';
import { authStatePath } from './support/auth';

/**
 * Der App-Shell-Cache aus `public/sw.js` — bis hierher die einzige Zusicherung
 * des Systems, die nur von Hand nachweisbar war.
 *
 * Warum sie einen Test verdient: der Service Worker wird **ausschließlich** im
 * Production-Build registriert (`ServiceWorkerRegistration.tsx` prüft
 * `NODE_ENV`), also sieht ihn keine andere Stufe der Prüfkette. Das ist
 * dieselbe Bauart wie bei der CSP, und die hat sieben Phasen lang unbemerkt
 * jede Hydration verhindert (notes.md, "Dieselbe CSP verhinderte in Production
 * jede Hydration"). Eine Absicherung, die in der gesamten Kette abgeschaltet
 * ist, ist ungeprüft.
 *
 * Und es hängt etwas daran: ohne diesen Cache lässt sich `/offline` auf einem
 * Tablet ohne Verbindung gar nicht erst **laden**. Alles darunter arbeitet aus
 * der IndexedDB, aber HTML und JavaScript müssen von irgendwoher kommen.
 *
 * Der konkrete Anlass war der Sprung auf Next 16: Turbopack baut jetzt, und
 * `sw.js` cacht Chunks ausschließlich unter `/_next/static/`. Läge dort auch
 * nur ein Teil der Auslieferung nicht mehr, wäre der Offline-Start still
 * kaputt — die Seite online tadellos, in der Halle weiß. Deshalb prüft der
 * erste Test die Herkunft der Chunks ausdrücklich mit.
 */

test.use({ storageState: authStatePath('worker') });

test('Der Service Worker übernimmt die Shell — und cacht genau die Chunks, die ausgeliefert werden', async ({
  page,
}) => {
  await page.goto('/offline');

  // `serviceWorker.ready` löst bereits im Zustand `activating` auf; gefragt
  // ist aber der Worker, der die Seite auch kontrolliert.
  //
  // Das Warten ist ausdrücklich begrenzt: bleibt die Registrierung aus — das
  // tatsächliche Fehlerbild, wenn jemand `ServiceWorkerRegistration` bricht
  // oder der Lauf versehentlich gegen `next dev` fährt —, wird `ready` **nie**
  // erfüllt. Ohne diese Schranke stirbt der Test nach 60 s am Playwright-
  // Timeout und sagt nur "page.evaluate: Test timeout exceeded". Nachgestellt,
  // und deshalb steht die Schranke hier.
  const state = await page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (!registration) return 'nicht registriert';
    const worker = registration.active;
    if (!worker) return 'kein aktiver Worker';
    if (worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        const onChange = (): void => {
          if (worker.state === 'activated') {
            worker.removeEventListener('statechange', onChange);
            resolve();
          }
        };
        worker.addEventListener('statechange', onChange);
        setTimeout(resolve, 5_000);
      });
    }
    return worker.state;
  });
  expect(state, 'Service Worker nicht aktiv — läuft der Server im Development-Modus?').toBe(
    'activated',
  );
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Die Herkunft der Chunks ist die eigentliche Zusicherung: `sw.js` cacht
  // nichts, was nicht unter /_next/static/ liegt.
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((path) => path.endsWith('.js') || path.endsWith('.css')),
  );
  expect(assets.length, 'Keine Skript-/Stilressourcen gemessen').toBeGreaterThan(0);
  expect(
    assets.filter((path) => !path.startsWith('/_next/static/')),
    'Ausgelieferte Chunks außerhalb von /_next/static/ — sw.js cacht sie nicht',
  ).toEqual([]);

  // Der Cache füllt sich für /_next/static/ erst, wenn die Anfragen durch den
  // Worker gelaufen sind — beim ersten Laden hat er noch nicht kontrolliert.
  await page.reload();
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const cache = await caches.open('proquado-shell-v1');
          return (await cache.keys()).map((request) => new URL(request.url).pathname);
        }),
      { message: 'Shell und Chunks landen nicht im Cache proquado-shell-v1' },
    )
    .toEqual(expect.arrayContaining(['/offline']));

  const cached: string[] = await page.evaluate(async () => {
    const cache = await caches.open('proquado-shell-v1');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(
    cached.some((path) => path.startsWith('/_next/static/')),
    `Kein Chunk im Cache: ${cached.join(', ')}`,
  ).toBe(true);
});

test('Ohne Verbindung lädt die Shell weiter, und jede Navigation landet im Offline-Arbeitsbereich', async ({
  page,
  context,
}) => {
  await page.goto('/offline');
  const registered = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]),
  );
  expect(registered, 'Kein Service Worker registriert — läuft der Server in Production?').toBe(
    true,
  );
  await page.reload();

  await context.setOffline(true);

  await page.reload();
  const navigation = await page.evaluate(() =>
    (performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]).map(
      (entry) => entry.transferSize,
    ),
  );
  expect(navigation[0], 'Antwort kam aus dem Netz — der Cache hat nicht getragen').toBe(0);
  await expect(page.locator('body')).not.toBeEmpty();

  // Der vorgesehene Rückfall (sw.js: "Any navigation while offline lands on
  // the offline workspace"). Ein Browserfehler wäre auf einem Hallentablet
  // eine Sackgasse ohne Ausweg.
  await page.goto('/dashboard');
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.getByRole('link', { name: 'Offline' })).toBeVisible();

  // Und die Gegenprobe, ohne die der Cache eine Gefahr statt einer Hilfe wäre:
  // /api/** wird nie gecacht. Eine veraltete Auskunft über einen
  // Schrittstatus ist schlechter als keine (docs/06).
  const apiResult = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/health');
      return `HTTP ${response.status}`;
    } catch {
      return 'unerreichbar';
    }
  });
  expect(apiResult, 'API wurde aus dem Cache beantwortet').toBe('unerreichbar');
});
