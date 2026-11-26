import { defineConfig } from 'vitest/config';
import aliases from './vitest.aliases.js';

// The acceptance gate can also run independently; the default suite includes it.
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['tests/acceptance/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks',
    testTimeout: 10000,
    hookTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
  },
});
