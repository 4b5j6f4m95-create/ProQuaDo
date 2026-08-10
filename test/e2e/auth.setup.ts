import { test as setup, expect, type Page } from '@playwright/test';
import { authStatePath, KEYCLOAK_PASSWORD, type DemoRole } from './support/auth';

/**
 * Meldet die Demo-Konten **über den echten Keycloak** an und legt die Sitzung
 * als storageState ab, damit die eigentlichen Tests nicht jedes Mal durch den
 * OIDC-Umweg müssen.
 *
 * Bewusst kein nachgebautes Cookie: die Anmeldung ist der Weg, auf dem die
 * Kontoverknüpfung (`pending:<email>`, src/lib/auth/resolve-login.ts)
 * überhaupt erst entsteht — und genau dieser Weg hat in Phase 7 zweimal
 * versagt, ohne dass eine Kontrolle es sah ("Ein Keycloak-Neuaufbau entwertete
 * alle Kontoverknüpfungen", "Der Seed legt nach dem ersten Login
 * Doppelbenutzer an"). Ein selbstgebautes Sitzungscookie hätte beides
 * übersprungen.
 */

async function signInAs(page: Page, role: DemoRole, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Mit SSO anmelden' }).click();

  // Keycloaks eigene Anmeldemaske — fremde Origin, deshalb ihre IDs und nicht
  // unsere Beschriftungen.
  await page.waitForURL(/\/realms\/proquado\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(KEYCLOAK_PASSWORD);
  await page.locator('#kc-login').click();

  // signIn('oidc', { redirectTo: '/projects' }) — kommt die Anmeldung nicht
  // hier an, ist sie fehlgeschlagen. Der häufigste Grund ist eine veraltete
  // Kontoverknüpfung, die auf dem Bildschirm nur "Access Denied" heißt.
  await page.waitForURL('**/projects', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();

  await page.context().storageState({ path: authStatePath(role) });
}

setup('Anmeldung als worker.test', async ({ page }) => {
  await signInAs(page, 'worker', 'worker.test');
});

setup('Anmeldung als pl.test', async ({ page }) => {
  await signInAs(page, 'projectLead', 'pl.test');
});

setup('Anmeldung als qm.test', async ({ page }) => {
  await signInAs(page, 'qualityManager', 'qm.test');
});

setup('Anmeldung als admin.test', async ({ page }) => {
  await signInAs(page, 'admin', 'admin.test');
});
