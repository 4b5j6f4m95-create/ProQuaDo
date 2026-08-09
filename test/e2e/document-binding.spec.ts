import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { closeScenarioDb, createPlanningScenario } from './support/scenario';

/**
 * Schritt-Dokumentbindung im Planungsbildschirm.
 *
 * Dieser Test existiert wegen zweier Fehler, die ausschließlich hier
 * auftreten konnten (notes.md, "Eine geworfene Ablehnung reißt in Next.js die
 * ganze Seite weg"): eine abgewiesene Dublette landete in der Fehlerseite und
 * nahm den Arbeitsstand des Planers mit, und nach dem Entfernen einer Bindung
 * behauptete die stehengebliebene Meldung weiter, die Revision sei "bereits
 * verknüpft". Der Dienst war in beiden Fällen korrekt — falsch war die Schicht
 * darüber. Typecheck, Integrationstests und `next build` sahen nichts davon.
 */

test.use({ storageState: authStatePath('projectLead') });

test.afterAll(async () => {
  await closeScenarioDb();
});

test('binden, Dublette abweisen, entfernen — ohne die Seite zu verlieren', async ({ page }) => {
  const fx = await createPlanningScenario();

  await page.goto(`/production-plans/${fx.planRevisionId}`);
  const planHeading = page.getByRole('heading', { name: /Fertigungsplan-Revision/ });
  await expect(planHeading).toBeVisible();

  const stepCard = page.locator('section.card', { hasText: fx.planStepTitle });
  const bindForm = stepCard.locator('form', { has: page.getByLabel('Dokumentrevision') });

  await bindForm.getByLabel('Dokumentrevision').selectOption({ label: fx.revisionOptionLabel });
  await bindForm.getByLabel(/Seite/).fill('3');
  await bindForm.getByLabel(/Markierung/).fill('Detail B');
  await bindForm.getByRole('button', { name: '+ Dokumentbindung' }).click();

  const binding = stepCard.locator('li', { hasText: fx.documentNumber });
  await expect(binding).toContainText('Rev. 01');
  await expect(binding).toContainText('S. 3');
  await expect(binding).toContainText('(Detail B)');

  // Dieselbe Revision noch einmal: eine Antwort, kein Absturz. Der Plan muss
  // danach unverändert dastehen — das war der eigentliche Schaden.
  await bindForm.getByLabel('Dokumentrevision').selectOption({ label: fx.revisionOptionLabel });
  await bindForm.getByRole('button', { name: '+ Dokumentbindung' }).click();
  await expect(bindForm.getByRole('alert')).toContainText(/bereits verknüpft/);
  await expect(planHeading).toBeVisible();
  await expect(binding).toHaveCount(1);

  // Entfernen: die Bindung geht, und mit ihr die Meldung, die über sie
  // sprach. Bliebe sie stehen, behauptete sie etwas Unwahres.
  await binding.getByRole('button', { name: 'entfernen' }).click();
  await expect(stepCard.locator('li', { hasText: fx.documentNumber })).toHaveCount(0);
  await expect(stepCard.getByRole('alert')).toHaveCount(0);
});
