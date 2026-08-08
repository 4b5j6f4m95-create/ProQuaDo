const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/**
 * Integration tests: spin up a real PostgreSQL via Testcontainers, apply
 * real migrations, exercise real RLS/RBAC/audit behavior. See
 * docs/09_TEST_PYRAMID.md "Ebene 3: Integrationstests". Requires Docker.
 */
module.exports = createJestConfig({
  displayName: 'integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 120_000,
});
