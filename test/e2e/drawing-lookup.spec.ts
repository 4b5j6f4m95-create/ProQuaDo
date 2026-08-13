import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { closeScenarioDb, createDrawingLookupScenario } from './support/scenario';

/**
 * Offene Zeichnungsverweise nachschlagen.
 *
 * Der Dienst ist in `test/integration/phase8-ifc-import.integration.test.ts`
 * abgedeckt. Dieser Test steht wegen eines Fehlers, den nur der Bildschirm
 * zeigen konnte: die Schaltfläche hing an „es gibt offene Verweise", und die
 * Erfolgsmeldung steckte in ihr. Nach einem erfolgreichen Lauf gab es keine
 * offenen Verweise mehr — also verschwand die Meldung im selben Augenblick,
 * in dem sie entstand. Wer drückte, sah die Zeichnung auftauchen und bekam
 * kein Wort dazu, ob das nun der Knopf war oder Zufall.
 *
 * Geprüft wird deshalb beides zusammen: dass die Bindung entsteht **und**
 * dass der Satz darüber stehen bleibt.
 */

test.use({ storageState: authStatePath('projectLead') });

test.afterAll(async () => {
  await closeScenarioDb();
});

test('nachschlagen bindet die inzwischen freigegebene Zeichnung — und sagt es auch', async ({
  page,
}) => {
  const fx = await createDrawingLookupScenario();

  await page.goto(`/production-plans/${fx.planRevisionId}`);
  await expect(page.getByRole('heading', { name: /Fertigungsplan-Revision/ })).toBeVisible();

  const stepCard = page.locator('section.card', { hasText: fx.stepTitle });
  // Ausgangslage: im Modell genannt, im Projekt (noch) nicht gefunden.
  await expect(stepCard).toContainText('Im Modell genannte Zeichnungen (1 nicht gebunden)');
  await expect(stepCard).toContainText('nicht im Projekt');

  await page.getByRole('button', { name: 'Zeichnungsverweise nachschlagen' }).click();

  // Der Satz bleibt stehen, obwohl es danach nichts mehr nachzuschlagen gibt.
  await expect(page.getByRole('status')).toContainText(
    '1 von 1 Zeichnungen gefunden und verbindlich gebunden.',
  );
  await expect(page.getByRole('button', { name: 'Zeichnungsverweise nachschlagen' })).toHaveCount(
    0,
  );

  // Und die Bindung ist wirklich entstanden, mit der Herkunft aus dem Modell.
  const binding = stepCard.locator('li', { hasText: fx.drawingNumber });
  await expect(binding).toContainText('Rev. 01');
  await expect(binding).toContainText('Aus IFC-Modell');
  await expect(stepCard).not.toContainText('nicht im Projekt');
});
