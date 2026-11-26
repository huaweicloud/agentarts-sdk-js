import { defineConfig } from 'vitest/config';
import aliases from './vitest.aliases.js';

export default defineConfig({
  resolve: {
    alias: aliases,
    extensions: ['.ts', '.mts', '.js', '.mjs', '.json'],
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/smoke/**/*.test.ts',
      'tests/acceptance/**/*.test.ts',
    ],
    exclude: ['tests/integration/**', '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    clearMocks: true,
    restoreMocks: true,
    // Toolkit tests change the working directory (process.chdir), which is not
    // supported by worker threads; run each test file in a child process.
    pool: 'forks',
  },
});
