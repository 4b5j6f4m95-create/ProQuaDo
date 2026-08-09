import { resolve } from 'node:path';

/**
 * Wer sich anmeldet, womit, und wohin die Sitzung abgelegt wird. Bewusst frei
 * von Anwendungsimports: das Setup-Projekt braucht keinen Prisma-Client, und
 * die Datei wird auch von Tests gelesen, die nur eine Rolle auswählen.
 *
 * Die Werte stammen aus infra/keycloak/proquado-realm.json und prisma/seed.ts
 * — Demo-Zugangsdaten einer lokalen Entwicklungsumgebung, keine Geheimnisse.
 */

export const DEMO_USERS = {
  worker: 'worker.test@proquado.local',
  projectLead: 'pl.test@proquado.local',
  qualityManager: 'qm.test@proquado.local',
  productionManager: 'pm.test@proquado.local',
  admin: 'admin.test@proquado.local',
} as const;

export type DemoRole = keyof typeof DEMO_USERS;

/** Keycloak-Passwort aller Demo-Konten (infra/keycloak/proquado-realm.json). */
export const KEYCLOAK_PASSWORD = 'devpassword';

/** Bestätigungs-PIN aller Demo-Konten (prisma/seed.ts). */
export const DEMO_PIN = '1234';

export function authStatePath(role: DemoRole): string {
  return resolve(process.cwd(), 'test/e2e/.auth', `${role}.json`);
}
