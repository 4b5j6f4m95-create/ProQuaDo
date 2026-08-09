import { defineConfig, devices } from '@playwright/test';
import { loadDotEnv } from './test/e2e/support/env';

loadDotEnv();

/**
 * Ebene 6 aus docs/09_TEST_PYRAMID.md — die Schicht, die keine andere Prüfung
 * dieses Projekts abdeckt: Server Actions, Formularzustand, Hydration.
 *
 * Zwei Entscheidungen, die den Rest der Datei erklären:
 *
 * 1. **Gefahren wird gegen den Production-Build, nicht gegen `next dev`.**
 *    Die CSP ist in der Entwicklung abgeschaltet und verhinderte in
 *    Production sieben Phasen lang jede Hydration, ohne dass Typecheck,
 *    Unit-, Integrationstests oder `next build` etwas gemerkt hätten (siehe
 *    notes.md, "Dieselbe CSP verhinderte in Production jede Hydration").
 *    Ein E2E-Lauf gegen den Dev-Server hätte genau diesen Fehler ebenfalls
 *    nicht gefunden. Jeder Test hier klickt mindestens eine Client-Komponente
 *    an — ohne Hydration schlägt er fehl.
 *
 * 2. **`reuseExistingServer: false`, und der Build gehört zum Kommando.**
 *    Ein bereits laufender Server auf diesem Port wäre womöglich ein
 *    Dev-Server, und der Lauf würde still die falsche Sache prüfen. Lieber
 *    ein Portkonflikt mit Fehlermeldung. Aus demselben Grund darf `next dev`
 *    während dieses Laufs nicht laufen: `pnpm run build` schreibt in dasselbe
 *    `.next/` (siehe notes.md, "`pnpm run build` neben laufendem `next dev`").
 *
 * Voraussetzungen: Postgres, MinIO und Keycloak laufen (`docker compose up -d
 * postgres minio minio-init keycloak`), Migrationen und Seed sind eingespielt.
 * Die Tests bauen ihre eigenen Fixtures — siehe test/e2e/support/scenario.ts.
 */

const PORT = Number(process.env.E2E_PORT ?? 3002);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './test/e2e',
  // Der Server ist einer, die Datenbank ist eine, und die PIN-Fehlversuchssperre
  // zählt je Benutzer: parallele Tests mit denselben Demo-Konten wären ein
  // Testlauf, der sich selbst aussperren kann.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e',
      dependencies: ['setup'],
      // Tablet-nahe Auflösung: die Ausführungsansicht ist für die Halle
      // gebaut (docs/07), nicht für einen Desktop-Browser.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
  ],

  webServer: {
    command: `pnpm run build && pnpm run start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    // Ausdrücklich, nicht geerbt: die lokale `.env` setzt NODE_ENV auf
    // "development", und geerbt hieße ein Server, der die CSP (src/middleware.ts
    // prüft NODE_ENV) gar nicht erst anwendet — also genau die Prüfung
    // aushebelt, für die dieser Lauf gegen den Production-Build fährt.
    env: { NODE_ENV: 'production' },
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
