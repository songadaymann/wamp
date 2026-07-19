import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/cloudflare/worker/runs/points.ts',
        'src/cloudflare/worker/progression/shared.ts',
        'src/runs/model.ts',
      ],
    },
  },
});
