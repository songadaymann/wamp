import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // About 60 test files use node:sqlite; its experimental warning would print once per file.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'output/coverage',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
    },
  },
});
