import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';

/**
 * ESLint-Konfiguration im Flat-Format. Ersetzt `.eslintrc.json`, weil ESLint
 * ab Version 9 kein anderes Format mehr liest.
 *
 * **Die Regellisten gehören weiterhin den Paketen, nicht uns** — nur der Weg
 * dorthin hat sich geändert. Bis ESLint 9 kamen `next/core-web-vitals`,
 * `plugin:@typescript-eslint/recommended` und `prettier` als klassische
 * Konfigurationen über `FlatCompat` herein. Seit ESLint 10 und
 * `eslint-config-next` 16 liefern alle drei Pakete Flat-Konfigurationen
 * unmittelbar; die Kompatibilitätsschicht (und mit ihr `@eslint/eslintrc`)
 * ist damit überflüssig geworden. Nachgebaut wird nach wie vor nichts.
 *
 * **Ein Unterschied, den man kennen muss:** `eslint-config-next/core-web-vitals`
 * registriert seit v16 zwar Parser und Plugin von `@typescript-eslint`, bringt
 * aber **keine** Regel daraus mit (`next/typescript` hat null Regeln). Ohne
 * den ausdrücklichen Eintrag `flat/recommended` unten wäre die halbe
 * TypeScript-Regelmenge stillschweigend verschwunden — genau die Art
 * Lockerung, die eine Konfiguration, die bloß „läuft", nicht anzeigt.
 *
 * Die Übersetzung wurde deshalb wieder nicht geglaubt, sondern verglichen:
 * `eslint --print-config` vor und nach der Umstellung, für je eine Datei aus
 * Anwendung, Komponenten, E2E-Tests, Seed und Lasttest. Gleiche Regeln,
 * gleiche Ausnahmen — dasselbe Vorgehen wie bei der Umstellung auf das
 * Flat-Format selbst.
 *
 * Reihenfolge zählt im Flat-Format: spätere Einträge überschreiben frühere,
 * und `ignores` in einem Eintrag ohne `files` gilt global.
 */

const config = [
  {
    ignores: [
      'node_modules/',
      // `**/` ist hier nicht schmückend. Im Flat-Format ist ein Muster ohne
      // Voranstellung **wurzelrelativ** — anders als in `.gitignore`, wo
      // `.next/` auf jeder Ebene greift. Wer mit einem Arbeitsverzeichnis
      // unter `.claude/worktrees/` arbeitet, hatte deshalb ein sauberes
      // `git status` und einen roten `pnpm run lint`: ESLint lief in das
      // Bauverzeichnis des zweiten Arbeitsverzeichnisses hinein und
      // beanstandete Nexts erzeugten Code. In der CI fiel das nie auf, weil
      // es dort keine Arbeitsverzeichnisse gibt.
      '**/node_modules/',
      '**/.next/',
      '.claude/worktrees/',
      // Vom Designer geliefertes Material — HTML-Entwürfe samt ihrer
      // mitgelieferten `support.js`. Fremder Code, den niemand hier
      // pflegt, und der die Prüfung mit sieben Beanstandungen rot färbte,
      // sobald die Mappe im Arbeitsverzeichnis lag.
      // Ohne Umlaut im Muster: macOS legt Dateinamen **zerlegt** ab
      // (NFD, „ä" = a + Trema), die Konfigurationsdatei steht in NFC.
      // Ein Muster mit „ä" trifft den Ordner deshalb nicht — er blieb
      // sichtbar, obwohl `git check-ignore` ihn längst ignorierte.
      '**/*Designvorschl*/',
      'dist/',
      'coverage/',
      'prisma/migrations/',
      'playwright-report/',
      'test-results/',
      // Von Next erzeugt, nicht unser Code — und Next 15 schreibt dort eine
      // Triple-Slash-Referenz hinein, die unsere eigene Regel verbietet.
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...typescriptEslint.configs['flat/recommended'],
  prettier,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Tests dürfen zugreifen, wo Produktionscode fragen müsste: ein `!` auf
    // eine Fixture, die der Test selbst angelegt hat, ist keine Annahme.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__tests__/**',
      'test/e2e/**',
      'test/load/**',
      'test/restore/**',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // Werkzeuge, deren Ausgabe der Zweck ist.
    files: ['prisma/seed.ts', 'scripts/**', 'test/load/**', 'test/restore/**'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['*.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];

export default config;
