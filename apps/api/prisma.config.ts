import { defineConfig } from 'prisma/config';

// The CLI does not load .env files by itself. Local development keeps the file next to this config.
try {
  process.loadEnvFile(new URL('./.env', import.meta.url));
} catch {
  // No .env file: the variables come from the environment (CI, containers).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
