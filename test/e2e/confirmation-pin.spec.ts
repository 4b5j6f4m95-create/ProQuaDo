import { test, expect } from './support/test';
import { authStatePath, DEMO_PIN } from './support/auth';
import {
  closeScenarioDb,
  readConfirmationPinHash,
  restoreConfirmationPinHash,
} from './support/scenario';

/**
 * Die Bestätigungs-PIN am Bildschirm setzen und ändern.
 *
 * Warum das über die Dienst-Tests hinaus einen E2E-Fall bekommt: es ist ein
 * Formular mit `useActionState`, und genau in dieser Schicht saßen in Phase 7
 * fast alle Fehler dieses Projekts — eine geworfene Ablehnung, die die Seite
 * wegriss, und ein Knopf, den seine eigene Vorbedingung sperrte. Die
 * Integrationstests rufen den Dienst; die Frage „was passiert bei falscher
 * bisheriger PIN im Browser" stellen sie nicht.
 *
 * **Warum `pl.test` und nicht der Worker:** dieser Test ändert notwendigerweise
 * eine PIN. Die Demo-Konten teilen sich alle Spezifikationen dieses Laufs, und
 * `worker.test` und `qm.test` bestätigen anderswo mit `DEMO_PIN`. Der
 * Projektleiter bestätigt in keiner anderen Datei — und der ursprüngliche Hash
 * wird danach zurückgeschrieben, damit die Umgebung so bleibt, wie notes.md
 * sie beschreibt.
 */

test.use({ storageState: authStatePath('projectLead') });

let originalHash: string | null = null;

test.beforeAll(async () => {
  originalHash = await readConfirmationPinHash('projectLead');
});

test.afterAll(async () => {
  // Auch nach einem Fehlschlag: sonst hinterlässt ein roter Lauf ein Konto
  // mit einer PIN, die niemand kennt.
  await restoreConfirmationPinHash('projectLead', originalHash);
  await closeScenarioDb();
});

test('Eine falsche bisherige PIN wird am Formular abgewiesen, ohne die Seite zu verlieren', async ({
  page,
}) => {
  await page.goto('/account');

  // Das Konto hat eine PIN, also fragt das Formular nach der bisherigen.
  await expect(page.getByRole('heading', { name: 'Bestätigungs-PIN ändern' })).toBeVisible();

  await page.getByLabel('Bisherige PIN').fill('0000');
  await page.getByLabel('Neue PIN (4–12 Ziffern)').fill('8305');
  await page.getByLabel('Neue PIN wiederholen').fill('8305');
  await page.getByRole('button', { name: 'PIN ändern' }).click();

  // Inline abgewiesen — nicht als Fehlerseite. Der Locator zeigt auf das
  // Element der Anwendung, weil `getByRole('alert')` in Next.js auch den
  // Routenansager trifft (notes.md).
  await expect(page.locator('#pin-form-error')).toContainText(/Noch \d+ Versuch/);
  await expect(page.getByRole('heading', { name: 'Bestätigungs-PIN ändern' })).toBeVisible();
});

test('Zwei verschiedene Eingaben werden abgewiesen, bevor irgendetwas gespeichert wird', async ({
  page,
}) => {
  await page.goto('/account');

  await page.getByLabel('Bisherige PIN').fill(DEMO_PIN);
  await page.getByLabel('Neue PIN (4–12 Ziffern)').fill('8305');
  await page.getByLabel('Neue PIN wiederholen').fill('8306');
  await page.getByRole('button', { name: 'PIN ändern' }).click();

  await expect(page.locator('#pin-form-error')).toContainText('stimmen nicht überein');

  // Die alte PIN gilt weiterhin — die Wiederholungsprüfung darf nichts
  // angefasst haben. Nachgewiesen am unveränderten Hash.
  expect(await readConfirmationPinHash('projectLead')).toBe(originalHash);
});

test('Die PIN lässt sich ändern, und die neue trägt', async ({ page }) => {
  await page.goto('/account');

  await page.getByLabel('Bisherige PIN').fill(DEMO_PIN);
  await page.getByLabel('Neue PIN (4–12 Ziffern)').fill('8305');
  await page.getByLabel('Neue PIN wiederholen').fill('8305');
  await page.getByRole('button', { name: 'PIN ändern' }).click();

  await expect(page.getByText('PIN geändert')).toBeVisible();

  // Der Beweis ist nicht die Meldung, sondern der geänderte Hash — und dass
  // er ein anderer ist als vorher, nicht bloß irgendeiner.
  const changed = await readConfirmationPinHash('projectLead');
  expect(changed).not.toBeNull();
  expect(changed).not.toBe(originalHash);
});
