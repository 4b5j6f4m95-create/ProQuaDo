import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * ESLint-Konfiguration im Flat-Format. Ersetzt `.eslintrc.json`, weil ESLint
 * ab Version 9 kein anderes Format mehr liest.
 *
 * **`FlatCompat` statt Neuschreiben.** `next/core-web-vitals` und
 * `plugin:@typescript-eslint/recommended` liegen weiterhin als klassische
 * Konfigurationen vor; sie hier von Hand nachzubauen hieße, ihre Regellisten
 * zu kopieren und bei jeder Aktualisierung nachzuziehen. Die Kompatibilitäts-
 * schicht ist die offizielle Brücke dafür und hält die Quelle bei den
 * Paketen, wo sie hingehört.
 *
 * Die Übersetzung wurde nicht geglaubt, sondern verglichen: `eslint
 * --print-config` vor und nach der Umstellung, für je eine Datei aus
 * Anwendung, Komponenten, E2E-Tests, Seed und Lasttest. Gleiche Regeln,
 * gleiche Ausnahmen — sonst wäre die Umstellung eine stille Lockerung
 * gewesen.
 *
 * Reihenfolge zählt im Flat-Format: spätere Einträge überschreiben frühere,
 * und `ignores` in einem Eintrag ohne `files` gilt global.
 */

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      'node_modules/',
      '.next/',
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

  ...compat.extends('next/core-web-vitals', 'plugin:@typescript-eslint/recommended', 'prettier'),

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
