import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4000;
const WEB_PORT = 3000;
// Overridable so that the suite can run inside a container on the compose network.
const STORAGE = process.env.E2E_STORAGE_URL ?? 'http://localhost:9090';

/**
 * End-to-end smoke tests against the built apps. Needs `pnpm build` first and the local
 * infrastructure running with migrations applied:
 *   docker compose up -d postgres storage && pnpm --filter api migrate:deploy
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          'postgresql://remember:remember@localhost:5432/remember_me',
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        GRANT_SIGNING_SECRET: 'e2e-signing-secret-0123456789abcdef',
        MEDIA_PUBLIC_URL: `${STORAGE}/remember-me`,
        S3_ENDPOINT: STORAGE,
        S3_BUCKET: 'remember-me',
        S3_ACCESS_KEY_ID: 'local',
        S3_SECRET_ACCESS_KEY: 'local',
        // Placeholders: the smoke test never reaches Stripe.
        STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
        STRIPE_WEBHOOK_SECRET: 'whsec_e2e_placeholder',
        STRIPE_PRICE_ID_PREMIUM: 'price_e2e_premium',
        STRIPE_PRICE_ID_CUSTOM_SLUG: 'price_e2e_custom_slug',
      },
    },
    {
      // The standalone server does not include the static assets; copy them next to it first.
      command:
        'cp -r .next/static .next/standalone/apps/web/.next/ && node .next/standalone/apps/web/server.js',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: {
        PORT: String(WEB_PORT),
        HOSTNAME: '127.0.0.1',
        INTERNAL_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
