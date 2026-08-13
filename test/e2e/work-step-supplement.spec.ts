import { test, expect } from './support/test';
import { authStatePath } from './support/auth';
import { closeScenarioDb, createSupplementScenario, readAuditEventTypes } from './support/scenario';

/**
 * Nachgereichte Unterlagen im Arbeitsschritt.
 *
 * Der Domänendienst ist in
 * `test/integration/phase8-work-step-supplements.integration.test.ts`
 * abgedeckt. Dieser Test steht wegen zweier Fehler, die **ausschließlich in
 * der Oberfläche** möglich waren und die beim Durchspielen im Browser
 * gefunden wurden — keine Prüfstufe darunter hätte sie gesehen:
 *
 * 1. Der erklärende Satz verwies auf einen Abschnitt „Verbindliche
 *    Unterlagen", den ein Schritt ohne Dokumentbindung gar nicht zeigt. Er
 *    schickte den Leser also an eine Stelle, die es nicht gab.
 * 2. Die Auswahlliste bot die Revision weiter an, die bereits beilag — ein
 *    Klick, dessen einzige mögliche Antwort eine Fehlermeldung war.
 *
 * Beides sind Aussagen über den Zustand des Bildschirms, nicht über den
 * Zustand der Datenbank. Deshalb hier und nicht eine Ebene tiefer.
 */

test.use({ storageState: authStatePath('projectLead') });

test.afterAll(async () => {
  await closeScenarioDb();
});

test('nachreichen, in der Akte wiederfinden, entfernen', async ({ page }) => {
  const fx = await createSupplementScenario();

  await page.goto(`/work-steps/${fx.stepInstanceId}`);
  await expect(page.getByRole('heading', { name: new RegExp(fx.stepTitle) })).toBeVisible();

  const section = page.locator('section.card', { hasText: 'Nachgereichte Unterlagen' });
  await expect(
    section.getByRole('heading', { name: 'Nachgereichte Unterlagen (0)' }),
  ).toBeVisible();

  // Regression zu Fehler 1: ohne Dokumentbindung gibt es keinen Abschnitt
  // „Verbindliche Unterlagen" — der Satz darf dann nicht dorthin verweisen.
  await expect(page.getByRole('heading', { name: 'Verbindliche Unterlagen' })).toHaveCount(0);
  await expect(section).toContainText('verbindlich ist allein der freigegebene Plan');
  await expect(section).not.toContainText('was oben unter');

  const addForm = section.locator('form', { has: page.getByLabel('Dokumentrevision') });
  await addForm.getByLabel('Dokumentrevision').selectOption({ label: fx.revisionOptionLabel });
  await addForm
    .getByLabel('Warum wird nachgereicht?')
    .fill('Zulassung des Lieferanten lag bei Planfreigabe noch nicht vor');
  await addForm.getByRole('button', { name: 'Unterlage nachreichen' }).click();

  const entry = section.locator('li', { hasText: fx.documentNumber });
  await expect(entry).toContainText(fx.documentTitle);
  await expect(entry).toContainText('Rev. 01');
  await expect(entry).toContainText(
    'Zulassung des Lieferanten lag bei Planfreigabe noch nicht vor',
  );
  await expect(
    section.getByRole('heading', { name: 'Nachgereichte Unterlagen (1)' }),
  ).toBeVisible();

  // Regression zu Fehler 2: was beiliegt, steht nicht mehr zur Auswahl. Hier
  // ist es die einzige freigegebene Revision des Projekts, also verschwindet
  // das Formular ganz — mit einem Satz, der den Grund nennt.
  await expect(section.getByLabel('Dokumentrevision')).toHaveCount(0);
  await expect(section).toContainText('liegen dem Schritt bereits bei');

  // Der Server hat es getan, nicht nur der Bildschirm behauptet es.
  expect(await readAuditEventTypes(fx.stepInstanceId)).toContain('work_step.supplement_added');

  // Die Akte führt sie getrennt von den verbindlichen Unterlagen, und das
  // ist der Zweck der ganzen Unterscheidung.
  await page.goto(`/production-orders/${fx.orderId}/dossier`);
  const dossierSection = page.locator('section.card', { hasText: 'Plan- und Dokumentrevisionen' });
  await expect(dossierSection).toContainText('Keine Dokumente verbindlich zugeordnet.');
  await expect(
    dossierSection.getByRole('heading', { name: /Nachgereichte Unterlagen/ }),
  ).toBeVisible();
  await expect(dossierSection).toContainText(fx.documentNumber);

  // Entfernen mit Begründung: die Zeile geht, das Formular kommt zurück.
  await page.goto(`/work-steps/${fx.stepInstanceId}`);
  const removeForm = section.locator('li', { hasText: fx.documentNumber }).locator('form');
  await removeForm.getByLabel('Grund für das Entfernen').fill('Falsche Revision erwischt');
  await removeForm.getByRole('button', { name: 'Entfernen' }).click();

  await expect(section.locator('li', { hasText: fx.documentNumber })).toHaveCount(0);
  await expect(section).toContainText('Nichts nachgereicht.');
  await expect(section.getByLabel('Dokumentrevision')).toBeVisible();

  // Die Zeile ist weg, der Vorgang bleibt — beide Ereignisse stehen im
  // append-only Audit-Trail (ADR-004).
  const events = await readAuditEventTypes(fx.stepInstanceId);
  expect(events).toContain('work_step.supplement_added');
  expect(events).toContain('work_step.supplement_removed');
});
