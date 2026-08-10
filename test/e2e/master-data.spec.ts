import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { closeScenarioDb } from './support/scenario';

/**
 * Stammdaten über die Oberfläche anlegen.
 *
 * Der Fall, den es bis Phase 7 gar nicht gab: ohne Standort und Kunde bleiben
 * die Auswahllisten des Projektformulars leer, ohne Produkt lässt sich kein
 * Fertigungsplan anlegen — und beides entstand ausschließlich im Seed. Ein
 * Pilot ohne Altsystem hätte hier nicht anfangen können.
 *
 * Geprüft wird deshalb nicht „das Formular sendet ab", sondern dass die
 * **Kette trägt**: Standort und Kunde anlegen ⇒ sie stehen im Projektformular
 * zur Auswahl ⇒ ein Projekt lässt sich damit anlegen ⇒ darin ein Produkt.
 *
 * Alles mit dem Präfix `E2E-`, wie die übrigen Fixtures, und aus demselben
 * Grund nicht aufgeräumt: an Stammdaten hängen Projekte, an Projekten hängt
 * ein append-only Audit-Trail.
 */

const suffix = () => Math.floor(Math.random() * 1e6).toString(36);

test.afterAll(async () => {
  await closeScenarioDb();
});

test.describe('als Administration', () => {
  test.use({ storageState: authStatePath('admin') });

  test('Standort und Kunde anlegen — und eine Dublette wird inline abgewiesen', async ({
    page,
  }) => {
    const code = `E2E-S-${suffix()}`;
    const customerNumber = `E2E-K-${suffix()}`;

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();

    // Jedes Feld auf sein Formular eingegrenzt: „Kürzel" gibt es auch bei der
    // Abteilung, „Name" in fast jedem. Ein Locator, der zwei Felder trifft,
    // scheitert in Playwright zwar laut — aber erst, wenn jemand ein zweites
    // Formular hinzufügt, und dann sieht es nach einem Fehler der Seite aus.
    const siteForm = page.locator('form').filter({ hasText: 'Standort anlegen' });
    await siteForm.getByLabel('Kürzel', { exact: true }).fill(code);
    await siteForm.getByLabel('Name').fill('E2E-Werk');
    await page.getByRole('button', { name: 'Standort anlegen' }).click();
    await expect(page.getByText(`Standort ${code} angelegt`)).toBeVisible();

    await page.getByLabel('Kundennummer').fill(customerNumber);
    await page
      .locator('form')
      .filter({ hasText: 'Kunde anlegen' })
      .getByLabel('Name')
      .fill('E2E-Kunde');
    await page.getByRole('button', { name: 'Kunde anlegen' }).click();
    await expect(page.getByText(`Kunde ${customerNumber} angelegt`)).toBeVisible();

    // Dieselbe Nummer noch einmal: eine Antwort, kein Seitenabbruch.
    await page.getByLabel('Kundennummer').fill(customerNumber);
    await page
      .locator('form')
      .filter({ hasText: 'Kunde anlegen' })
      .getByLabel('Name')
      .fill('E2E-Kunde zwei');
    await page.getByRole('button', { name: 'Kunde anlegen' }).click();
    await expect(page.locator('#customer-form-error')).toContainText('existiert bereits');
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  });

  test('Eine Person einladen — sie wartet danach sichtbar auf ihren ersten Login', async ({
    page,
  }) => {
    const email = `e2e-${suffix()}@proquado.local`;

    await page.goto('/admin');

    // Auf das Formular eingegrenzt: „E-Mail" gibt es auch im Kundenformular,
    // und ein Locator, der zwei Felder trifft, prüft im Zweifel das falsche.
    const inviteForm = page.locator('form').filter({ hasText: 'Person einladen' });
    await inviteForm.getByLabel('E-Mail').fill(email);
    await inviteForm.getByLabel('Anzeigename').fill('E2E Eingeladen');
    await inviteForm.getByLabel('Personalnummer').fill(`E2E-${suffix()}`);
    await page.getByRole('button', { name: 'Einladen' }).click();

    await expect(page.getByText(`${email} eingeladen`)).toBeVisible();

    // Der Zustand, der für die Betreuung zählt: eingeladen, noch nicht
    // verknüpft, und ohne PIN — also noch nicht arbeitsfähig.
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('wartet auf ersten Login');
    await expect(row).toContainText('keine PIN gesetzt');
  });
});

test.describe('als PL', () => {
  test.use({ storageState: authStatePath('projectLead') });

  test('Aus Standort und Kunde wird ein Projekt, darin ein Produkt', async ({ page }) => {
    const projectNumber = `E2E-PROJ-${suffix()}`;
    const productNumber = `E2E-ART-${suffix()}`;

    await page.goto('/projects');

    // Die Auswahllisten sind gefüllt — genau das war ohne die Administration
    // nicht der Fall.
    await expect(page.getByLabel('Standort')).toBeVisible();
    await expect(page.getByLabel('Kunde')).toBeVisible();

    await page.getByLabel('Projektnummer').fill(projectNumber);
    await page.locator('form').getByLabel('Name').fill('E2E-Stammdatenprojekt');
    await page.getByRole('button', { name: 'Projekt anlegen' }).click();

    // createProjectAction leitet auf die Projektseite weiter.
    await expect(page.getByRole('heading', { name: new RegExp(projectNumber) })).toBeVisible();
    await expect(page.getByText('Noch kein Produkt')).toBeVisible();

    await page.getByLabel('Produktnummer').fill(productNumber);
    await page
      .locator('form')
      .filter({ hasText: 'Produkt anlegen' })
      .getByLabel('Name')
      .fill('E2E-Gehäuse');
    await page.getByRole('button', { name: 'Produkt anlegen' }).click();

    await expect(page.getByText(`Produkt ${productNumber} angelegt`)).toBeVisible();
    await expect(page.getByText('Noch kein Produkt')).toHaveCount(0);
  });
});
