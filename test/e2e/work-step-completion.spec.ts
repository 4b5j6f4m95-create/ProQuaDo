import { test, expect } from './support/test';
import { authStatePath, DEMO_PIN } from './support/auth';
import {
  closeScenarioDb,
  createExecutionScenario,
  readAuditEventTypes,
  readStepStatuses,
} from './support/scenario';

/**
 * Ebene 6, Fall 1 aus docs/09_TEST_PYRAMID.md: "Worker completes step online,
 * next step releases immediately".
 *
 * Der zweite Test ist kein Beiwerk. Der schwerste UI-Fehler der Phase 7 war
 * ein Abschlussknopf, den eine Toleranzverletzung deaktivierte — womit ein
 * Messwert außerhalb der Toleranz den Server nie erreichte und die
 * Qualitätssicherung von der Abweichung nichts erfuhr (notes.md, "Der
 * Abschlussknopf war dauerhaft gesperrt"). Keine Integrations- oder
 * Unit-Prüfung konnte das sehen: sie rufen den Dienst, und der Dienst war
 * richtig. Die Frage "darf der Knopf gedrückt werden" stellt sich erst im
 * Browser.
 */

test.use({ storageState: authStatePath('worker') });

test.afterAll(async () => {
  await closeScenarioDb();
});

test('Schritt 1 abschließen — den Nachfolger gibt danach der Server frei', async ({ page }) => {
  const fx = await createExecutionScenario();

  // Der Einstieg des Tablets: nur zugewiesene Aufträge, und nur der Schritt,
  // der gerade dran ist (docs/07 A1).
  await page.goto('/my-orders');
  const orderCard = page.locator('section.card', { hasText: fx.orderNumber });
  await expect(orderCard).toContainText('Schritt 1 von 2');

  // Vorher: der Folgeschritt ist gesperrt, und zwar sichtbar begründet — kein
  // Startknopf, den man nur nicht drücken soll (docs/07 A7).
  await page.goto(`/work-steps/${fx.step2InstanceId}`);
  await expect(page.getByText(/Dieser Arbeitsschritt ist gesperrt/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arbeitsschritt starten' })).toHaveCount(0);
  expect(await readStepStatuses(fx.orderId)).toEqual(['READY', 'LOCKED']);

  await page.goto('/my-orders');
  await orderCard.getByRole('link', { name: 'Öffnen →' }).click();
  await expect(
    page.getByRole('heading', { name: `Schritt 1 von 2: ${fx.step1Title}` }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Arbeitsschritt starten' }).click();
  await expect(page.getByRole('heading', { name: /Offene Anforderungen/ })).toBeVisible();

  // Checkliste
  const checklistRow = page.locator('.checklist-row', { hasText: fx.checklistItemText });
  await checklistRow.getByRole('radio', { name: 'OK', exact: true }).check();
  await checklistRow.getByRole('button', { name: 'Speichern' }).click();
  await expect(checklistRow).toContainText('— OK');

  // Messwert innerhalb der Toleranz (1.8–2.2)
  // Über den Knopf adressiert, nicht über den Merkmalsnamen: der steht auch
  // in der Liste der offenen Anforderungen, und die kommt später im Dokument.
  const measurementForm = page.locator('form', {
    has: page.getByRole('button', { name: 'Messwert speichern' }),
  });
  await measurementForm.getByLabel(/Istwert/).fill('2.1');
  await measurementForm.getByRole('button', { name: 'Messwert speichern' }).click();
  await expect(page.getByText('✓ in Toleranz')).toBeVisible();

  // Die eine offene Anforderung ist jetzt die Bestätigung, die genau dieses
  // Formular erzeugt — sie darf den Knopf nicht sperren.
  await expect(page.getByRole('heading', { name: 'Offene Anforderungen (1)' })).toBeVisible();
  const completeButton = page.getByRole('button', { name: 'Bestätigen und abschließen' });
  await expect(completeButton).toBeEnabled();

  // Falsche PIN: eine Antwort auf dem Bildschirm, kein Seitenabbruch.
  await page.getByLabel('PIN').fill('9999');
  await completeButton.click();
  // Gezielt die Meldung des Formulars: Next.js hält einen eigenen
  // role="alert"-Bereich für Routenansagen bereit, der leer ist.
  await expect(page.locator('#pin-error')).toContainText(/PIN.*Noch \d+ Versuch/);
  await expect(
    page.getByRole('heading', { name: `Schritt 1 von 2: ${fx.step1Title}` }),
  ).toBeVisible();
  expect(await readStepStatuses(fx.orderId)).toEqual(['IN_PROGRESS', 'LOCKED']);

  await page.getByLabel('PIN').fill(DEMO_PIN);
  await completeButton.click();

  await expect(page.getByRole('heading', { name: /Schritt 1 abgeschlossen/ })).toBeVisible();
  await expect(page.getByText('Schritt 2 wurde freigegeben.')).toBeVisible();

  // Und dasselbe noch einmal dort, wo es zählt.
  expect(await readStepStatuses(fx.orderId)).toEqual(['COMPLETED', 'READY']);
  expect(await readAuditEventTypes(fx.step1InstanceId)).toEqual([
    'work_step.released',
    'work_step.started',
    'work_step.completion_submitted',
    'work_step.completed',
  ]);

  // Der freigegebene Nachfolger ist jetzt tatsächlich zu starten.
  await page.getByRole('link', { name: 'Weiter →' }).click();
  await expect(
    page.getByRole('heading', { name: `Schritt 2 von 2: ${fx.step2Title}` }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arbeitsschritt starten' })).toBeEnabled();
});

test('Messwert außerhalb der Toleranz erreicht den Server und erzeugt die Abweichung', async ({
  page,
}) => {
  const fx = await createExecutionScenario();

  await page.goto(`/work-steps/${fx.step1InstanceId}`);
  await page.getByRole('button', { name: 'Arbeitsschritt starten' }).click();

  const checklistRow = page.locator('.checklist-row', { hasText: fx.checklistItemText });
  await checklistRow.getByRole('radio', { name: 'OK', exact: true }).check();
  await checklistRow.getByRole('button', { name: 'Speichern' }).click();

  // Über den Knopf adressiert, nicht über den Merkmalsnamen: der steht auch
  // in der Liste der offenen Anforderungen, und die kommt später im Dokument.
  const measurementForm = page.locator('form', {
    has: page.getByRole('button', { name: 'Messwert speichern' }),
  });
  await measurementForm.getByLabel(/Istwert/).fill('3.5'); // Toleranz ist 1.8–2.2
  await measurementForm.getByRole('button', { name: 'Messwert speichern' }).click();
  await expect(page.getByText('⚠ außerhalb Toleranz')).toBeVisible();

  // Die Verletzung steht in der Liste der offenen Anforderungen — der
  // Mitarbeiter soll sie sehen —, aber sie sperrt den Knopf nicht. Sonst
  // verhinderte die Sperre, dass der Fehler überhaupt gemeldet wird.
  await expect(page.getByRole('heading', { name: 'Offene Anforderungen (2)' })).toBeVisible();
  const completeButton = page.getByRole('button', { name: 'Bestätigen und abschließen' });
  await expect(completeButton).toBeEnabled();

  await page.getByLabel('PIN').fill(DEMO_PIN);
  await completeButton.click();

  // Der Server nimmt die Meldung an, lehnt den Abschluss ab und erzeugt die
  // NCR selbst (Abnahmeszenario D). Der Schritt ist gesperrt, nicht fertig.
  await expect(page.getByRole('heading', { name: /Qualitätssperre/ })).toBeVisible();
  expect(await readStepStatuses(fx.orderId)).toEqual(['BLOCKED', 'LOCKED']);
});
