import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/trpc/**', 'src/services/**'],
    },
  },
  resolve: {
    alias: {
      '@maestro/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
