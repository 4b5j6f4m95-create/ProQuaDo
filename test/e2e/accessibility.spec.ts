import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { expectNoAccessibilityViolations } from './support/axe';
import {
  closeScenarioDb,
  createExecutionScenario,
  createPlanningScenario,
} from './support/scenario';

/**
 * Ebene 9: axe-core gegen die Bildschirme, an denen tatsächlich gearbeitet
 * wird — nicht gegen eine Startseite.
 *
 * Geprüft wird jeweils der Zustand mit den meisten Bedienelementen: der
 * Arbeitsschritt **in Arbeit** (Checkliste, Messwert, PIN-Bestätigung), der
 * Planungsbildschirm im **DRAFT** (fünf Formulare je Schritt), die Akte mit
 * dem **Freigabeformular**. Ein leerer Zustand hat keine Barrieren, weil er
 * nichts hat.
 */

test.afterAll(async () => {
  await closeScenarioDb();
});

test.describe('ohne Anmeldung', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Anmeldeseite', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Mit SSO anmelden' })).toBeVisible();
    await expectNoAccessibilityViolations(page, '/login');
  });
});

test.describe('als Worker (Tablet)', () => {
  test.use({ storageState: authStatePath('worker') });

  test('Meine Aufträge und der Arbeitsschritt in Arbeit', async ({ page }) => {
    const fx = await createExecutionScenario({ startFirstStep: true });

    await page.goto('/my-orders');
    await expect(page.getByRole('heading', { name: 'Meine Aufträge' })).toBeVisible();
    await expectNoAccessibilityViolations(page, '/my-orders');

    await page.goto(`/work-steps/${fx.step1InstanceId}`);
    // Erst wenn die Formulare da sind, ist die Seite der Prüfung wert. Der
    // Abschlussknopf heißt hier noch „Abschließen (2 fehlend)" — nichts ist
    // erfasst —, das PIN-Feld daneben gibt es trotzdem schon.
    await expect(page.getByLabel('PIN')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Messwert speichern' })).toBeVisible();
    await expectNoAccessibilityViolations(page, 'Arbeitsschritt (IN_PROGRESS)');
  });
});

test.describe('als PL', () => {
  test.use({ storageState: authStatePath('projectLead') });

  test('Planungsbildschirm im Entwurf', async ({ page }) => {
    const fx = await createPlanningScenario();

    await page.goto(`/production-plans/${fx.planRevisionId}`);
    await expect(page.getByRole('button', { name: '+ Dokumentbindung' })).toBeVisible();
    await expectNoAccessibilityViolations(page, 'Fertigungsplan (DRAFT)');
  });

  test('Mein Konto mit PIN-Formular', async ({ page }) => {
    // Drei Passwortfelder in einem Formular — die Art Bildschirm, an der
    // fehlende Beschriftungen und zu kleine Ziele am ehesten auffallen, und
    // der erste, den ein neues Konto überhaupt zu sehen bekommt.
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: /Bestätigungs-PIN/ })).toBeVisible();
    await expectNoAccessibilityViolations(page, 'Mein Konto');
  });
});

test.describe('als QM', () => {
  test.use({ storageState: authStatePath('qualityManager') });

  test('Übersicht und Akte mit Freigabeformular', async ({ page }) => {
    const fx = await createExecutionScenario({ completeAllSteps: true });

    await page.goto('/dashboard');
    await expectNoAccessibilityViolations(page, '/dashboard');

    await page.goto(`/production-orders/${fx.orderId}/dossier`);
    await expect(page.getByRole('button', { name: 'Produkt freigeben' })).toBeVisible();
    await expectNoAccessibilityViolations(page, 'Produktionsakte mit Freigabeformular');
  });
});
