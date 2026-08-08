const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** Unit tests: pure functions and logic with no database/network dependency. */
module.exports = createJestConfig({
  displayName: 'unit',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
});
