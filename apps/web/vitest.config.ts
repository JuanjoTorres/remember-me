import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.join(import.meta.dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    // Generous on purpose: one test starts ESLint, and on a shared CI runner these tests have been
    // starved past the 5 s default. A timeout here should mean "hung", never "slow machine".
    testTimeout: 30_000,
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      INTERNAL_API_URL: 'http://api.internal:4000',
    },
  },
});
