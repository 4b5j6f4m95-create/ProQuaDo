const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** Unit tests: pure functions and logic with no database/network dependency. */
module.exports = createJestConfig({
  displayName: 'unit',
  testEnvironment: 'node',
  // Auch die Helfer des Lasttests. Sie enthalten inzwischen echte Logik —
  // die Vereinigung überlappender Zeitabschnitte und das Urteil über eine
  // Messreihe —, und ein Rechenfehler darin verfälscht keine Anzeige, sondern
  // eine Entscheidung über Hardware.
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/test/load/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
});
