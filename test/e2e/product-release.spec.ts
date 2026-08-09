import { test, expect } from './support/test';
import { authStatePath, DEMO_PIN } from './support/auth';
import {
  closeScenarioDb,
  createExecutionScenario,
  readOrderStatus,
  readProductReleaseDecisions,
  type ExecutionScenario,
} from './support/scenario';

/**
 * Abschnitt 9 der Akte — die Produktfreigabe als eigener Vorgang (Phase 7).
 *
 * Zwei Dinge sind hier E2E-Gegenstand und sonst nirgends: dass das Formular
 * **nur** dort erscheint, wo jemand entscheiden darf, und dass eine
 * abgewiesene Entscheidung auf dem Bildschirm landet statt in der
 * Fehlerseite. Die Regeln dahinter (einmal freigeben, beliebig oft ablehnen,
 * kopierte Grundlage) haben Integrationstests; wer sie zu sehen bekommt,
 * entscheidet die Seite.
 */

test.afterAll(async () => {
  await closeScenarioDb();
});

test.describe('als QM', () => {
  test.use({ storageState: authStatePath('qualityManager') });

  test('ablehnen und danach freigeben — beides mit Begründung und PIN', async ({ page }) => {
    const fx: ExecutionScenario = await createExecutionScenario({ completeAllSteps: true });
    expect(await readOrderStatus(fx.orderId)).toBe('COMPLETED');

    await page.goto(`/production-orders/${fx.orderId}/dossier`);
    await expect(
      page.getByRole('heading', { name: '9. Endprüfung und Produktfreigabe' }),
    ).toBeVisible();
    // Abgeschlossen ist nicht freigegeben — solange niemand entschieden hat,
    // steht das ausdrücklich da.
    await expect(page.getByText(/keine Produktfreigabe-Entscheidung vor/)).toBeVisible();

    const form = page.locator('form', { hasText: 'Produktfreigabe entscheiden' });
    await expect(form).toBeVisible();

    // Reine Leerzeichen: der Browser lässt sie durch (required ist erfüllt),
    // der Server weist sie ab — inline, mit erhaltenem Formular.
    await form.getByLabel(/Begründung/).fill('   ');
    await form.getByLabel('PIN').fill(DEMO_PIN);
    await form.getByRole('button', { name: 'Freigabe ablehnen' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    expect(await readProductReleaseDecisions(fx.orderId)).toEqual([]);

    // Ablehnung mit echter Begründung.
    await form.getByLabel(/Begründung/).fill('Oberfläche am Deckel nicht abgenommen.');
    await form.getByLabel('PIN').fill(DEMO_PIN);
    await form.getByRole('button', { name: 'Freigabe ablehnen' }).click();
    await expect(page.getByText('Produktfreigabe abgelehnt')).toBeVisible();
    await expect(page.getByText('Oberfläche am Deckel nicht abgenommen.')).toBeVisible();

    // Die Ablehnung schließt nichts ab: das Formular bleibt stehen, weil
    // "abgelehnt → Nacharbeit → freigegeben" der Normalfall ist.
    await expect(form).toBeVisible();

    await form.getByLabel(/Begründung/).fill('Nachgeprüft, Oberfläche abgenommen.');
    await form.getByLabel('PIN').fill(DEMO_PIN);
    await form.getByRole('button', { name: 'Produkt freigeben' }).click();
    await expect(page.getByText('Produkt freigegeben')).toBeVisible();

    // Nach der erteilten Freigabe verschwindet das Formular — eine Rücknahme
    // wäre ein Rückruf, keine Korrektur, und findet hier nicht statt.
    await expect(form).toHaveCount(0);

    // Beide Entscheidungen stehen in der Historie, die Ablehnung bleibt lesbar.
    const decisions = await readProductReleaseDecisions(fx.orderId);
    expect(decisions.map((d) => d.decision)).toEqual(['REJECTED', 'RELEASED']);
    expect(decisions[0]!.reason).toBe('Oberfläche am Deckel nicht abgenommen.');
  });
});

test.describe('als PL', () => {
  test.use({ storageState: authStatePath('projectLead') });

  test('sieht Abschnitt 9, aber kein Freigabeformular', async ({ page }) => {
    const fx = await createExecutionScenario({ completeAllSteps: true });

    await page.goto(`/production-orders/${fx.orderId}/dossier`);
    await expect(
      page.getByRole('heading', { name: '9. Endprüfung und Produktfreigabe' }),
    ).toBeVisible();
    // product_release.view ja, product_release.decide nein — die Akte ist
    // lesbar, die Entscheidung nicht.
    await expect(page.getByText('Produktfreigabe entscheiden')).toHaveCount(0);
  });
});
