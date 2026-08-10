import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { closeScenarioDb, createExecutionScenario, resetExportRateLimit } from './support/scenario';

/**
 * Der PDF- und ZIP-Export der Produktionsakte — bis hierher die letzte Stelle,
 * an der ein Bündelungsfehler unbemerkt durch die gesamte Prüfkette gekommen
 * wäre.
 *
 * Warum keine andere Stufe ihn sieht: `pdfkit` liest die Metriken seiner
 * Standardschriften zur **Laufzeit** von der Platte, `archiver` ist aus
 * denselben Gründen als extern markiert (`serverExternalPackages` in
 * `next.config.mjs`). Ein Typecheck bemerkt davon nichts, `next build` auch
 * nicht — es ist kein Kompilierschritt, sondern ein Dateizugriff —, und die
 * Integrationstests rufen den Dienst über Jest, das aus `node_modules` auflöst
 * und nie bündelt. Genau so ist der Fehler in Phase 6 entstanden
 * (`ENOENT … .next/server/vendor-chunks/data/Helvetica.afm`, notes.md), und
 * genau deshalb musste der Export beim Sprung auf Next 16 wieder von Hand
 * geprüft werden: Turbopack baut jetzt.
 *
 * Der Test prüft deshalb nicht, dass der Dienst antwortet, sondern dass am
 * Ende **Bytes** herauskommen, die ein PDF beziehungsweise ein ZIP sind — und
 * er holt sie über denselben Knopf und denselben Downloadlink, die ein Mensch
 * benutzt.
 */

test.use({ storageState: authStatePath('qualityManager') });

test.afterAll(async () => {
  await closeScenarioDb();
});

/**
 * `EXPORT` erlaubt fünf Exporte je Benutzer und Stunde (docs/05, das Mittel,
 * auf das sich ADR-007 beruft). Diese Datei verbraucht zwei — ohne Rücksetzen
 * wäre der dritte Lauf innerhalb einer Stunde rot, ohne dass etwas kaputt
 * wäre. Zurückgesetzt wird das Fenster, nicht die Grenze angehoben: geprüft
 * werden soll, was ausgeliefert wird.
 */
test.beforeEach(async () => {
  await resetExportRateLimit('qualityManager');
});

/**
 * Knopf drücken, warten bis der Export durch ist, Datei holen.
 *
 * Das Warten hängt bewusst am **Ende des Pending-Zustands** und nicht direkt am
 * Downloadlink. Der Grund ist der Fehlerfall: ein Bündelungsfehler wirft ein
 * `ENOENT`, und das ist keine `DomainError` — die Server Action reicht es
 * durch, statt es als `{ error }` zurückzugeben, das Formular zeigt also
 * **nichts** an. Wer auf den Link wartet, wartet dann bis zum Timeout und
 * bekommt am Ende „locator not visible" zu lesen. Nachgestellt (pdfkit aus
 * `serverExternalPackages` entfernt): 30 s je Fall und keine Aussage.
 *
 * Über den Knopf ist der Vorgang messbar abgeschlossen, sobald `useFormStatus`
 * `pending` fallen lässt — danach ist ein fehlender Link kein Warten mehr,
 * sondern ein Befund, und die Meldung nennt ihn.
 */
async function exportAndDownload(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  buttonName: string,
): Promise<Buffer> {
  await page.getByRole('button', { name: buttonName }).click();

  await expect(
    page.getByRole('button', { name: 'Akte wird erzeugt…' }),
    'Der Export ist nach 30 s noch nicht fertig',
  ).toHaveCount(0, { timeout: 30_000 });

  // `getByRole('alert')` trifft in Next.js auch den Routenansager (notes.md),
  // deshalb auf das Formular eingegrenzt.
  const formAlert = page.locator('form').getByRole('alert');
  const message = (await formAlert.count()) > 0 ? await formAlert.first().innerText() : null;

  const downloadLink = page.getByRole('link', { name: 'Download starten' });
  await expect(
    downloadLink,
    message
      ? `Export abgelehnt: ${message}`
      : 'Kein Downloadlink und keine Meldung — der Export ist geworfen worden, ' +
          'vermutlich beim Erzeugen. Serverprotokoll ansehen.',
  ).toBeVisible({ timeout: 5_000 });

  const href = await downloadLink.getAttribute('href');
  expect(href, 'Downloadlink ohne Ziel').toBeTruthy();

  const download = await request.get(href!);
  expect(download.status(), 'Signierte Download-URL nicht einlösbar').toBe(200);
  return download.body();
}

test('Der PDF-Export liefert ein PDF — pdfkit findet seine Schriftmetriken auch im gebündelten Server', async ({
  page,
  request,
}) => {
  const fx = await createExecutionScenario({ completeAllSteps: true });

  await page.goto(`/production-orders/${fx.orderId}/dossier`);
  const bytes = await exportAndDownload(page, request, 'Als PDF exportieren');

  // Die eigentliche Zusicherung. Ein Bündelungsfehler äußert sich nicht als
  // leere Datei, sondern als Ausnahme beim Erzeugen — der Test stünde dann
  // schon oben. Die Signatur schließt den Rest aus: eine Fehlerseite, ein
  // leerer Strom, ein ZIP statt eines PDF.
  expect(bytes.subarray(0, 4).toString('latin1'), `Kein PDF: ${bytes.length} Bytes`).toBe('%PDF');
  expect(bytes.length, 'Verdächtig kleines PDF').toBeGreaterThan(1_000);
});

test('Der ZIP-Export liefert ein Archiv mit Manifest — archiver läuft im gebündelten Server', async ({
  page,
  request,
}) => {
  const fx = await createExecutionScenario({ completeAllSteps: true });

  await page.goto(`/production-orders/${fx.orderId}/dossier`);
  const bytes = await exportAndDownload(page, request, 'Als ZIP mit Nachweisen exportieren');

  expect(bytes.subarray(0, 2).toString('latin1'), `Kein ZIP: ${bytes.length} Bytes`).toBe('PK');

  // Ein „PK" am Anfang sagt nur, dass die ersten zwei Bytes stimmen. Das
  // End-of-Central-Directory am Ende sagt, dass das Archiv vollständig
  // geschrieben wurde, und nennt die Zahl der Einträge — ein abgebrochener
  // Strom hat es nicht. Ohne Bibliothek gelesen: die Signatur PK\x05\x06,
  // dahinter an Position 10 die Gesamtzahl der Einträge (uint16, LE).
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd, 'Kein End-of-Central-Directory — Archiv unvollständig').toBeGreaterThan(-1);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  expect(entryCount, 'Leeres Archiv').toBeGreaterThan(0);

  // Dateinamen stehen in den Headern im Klartext, auch wenn der Inhalt
  // komprimiert ist. Das Manifest ist der Teil, der Abnahmeszenario F trägt:
  // ohne es ist das ZIP ein Haufen Dateien statt eines geprüften Nachweises.
  expect(
    bytes.includes(Buffer.from('manifest.json')),
    `manifest.json fehlt im Archiv (${entryCount} Einträge)`,
  ).toBe(true);

  // Der Job-Datensatz aus ADR-007 ist kein Beiwerk: an ihm hängt, dass sich
  // ein Export später wiederfinden lässt. Nach dem Neuladen steht er in der
  // Liste der früheren Exporte.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Frühere Exporte' })).toBeVisible();
  await expect(page.getByText('ZIP', { exact: false }).first()).toBeVisible();
});
