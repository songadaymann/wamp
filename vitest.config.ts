import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'output/coverage',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
    },
  },
});
