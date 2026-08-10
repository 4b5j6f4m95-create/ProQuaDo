import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { closeScenarioDb, createUploadableDocument } from './support/scenario';

/**
 * Ein echter Upload aus dem Browser in den Objektspeicher.
 *
 * Der Weg ist der aus ADR-003: der Server stellt eine presignierte URL aus,
 * und der **Browser** lädt damit direkt zum Objektspeicher — am Anwendungs-
 * server vorbei. Genau deshalb gehört das hierher und nicht in einen
 * Integrationstest: dort lädt Node hoch, und Node kennt keine CSP.
 *
 * Die Production-CSP setzt `connect-src`. Liegt der Objektspeicher auf einer
 * anderen Origin als die Anwendung — der Normalfall, hier :9010 gegen :3002 —
 * entscheidet diese Direktive darüber, ob in der Halle je ein Foto ankommt.
 * Die Entwicklung sieht davon nichts, weil die CSP dort abgeschaltet ist.
 */

const BASE_ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 3002}`;

test.use({ storageState: authStatePath('projectLead') });

test.afterAll(async () => {
  await closeScenarioDb();
});

test('Datei landet im Objektspeicher, obwohl er auf einer anderen Origin liegt', async ({
  page,
}) => {
  const fx = await createUploadableDocument();

  await page.goto(`/documents/${fx.documentId}`);
  await expect(page.getByRole('heading', { name: new RegExp(fx.documentNumber) })).toBeVisible();
  await expect(page.getByText('Keine Datei hochgeladen.')).toBeVisible();

  // Der Prüfgegenstand ist der PUT auf die fremde Origin. Er wird direkt
  // beobachtet, statt über das Ergebnis geraten zu werden: was danach
  // serverseitig passiert, hängt an Dingen, die mit der CSP nichts zu tun
  // haben (siehe unten).
  const crossOriginPut = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && !response.url().startsWith(BASE_ORIGIN),
  );

  await page.getByLabel('Datei hochladen').setInputFiles({
    name: 'zeichnung.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('E2E Upload — Inhalt für den Hashvergleich'),
  });

  const response = await crossOriginPut;
  expect(response.status(), 'presignierter PUT in den Objektspeicher').toBe(200);

  // Dass der Anwendungsserver die Datei anschließend **anerkennt**, prüft
  // dieser Test bewusst nicht: er läuft gegen einen Production-Build, und dort
  // wird `MALWARE_SCANNER=stub` mit hartem Fehler abgelehnt (richtig so, siehe
  // malware-scan.ts). Der Abschluss des Uploads samt Hashvergleich und
  // Scan-Ergebnis hat Integrationstests, die mit echtem clamd laufen
  // (`CLAMAV_TESTS=1`). Hier zählt die Strecke davor — die nur der Browser
  // gehen kann, und die vor der Korrektur an der CSP endete.
});
