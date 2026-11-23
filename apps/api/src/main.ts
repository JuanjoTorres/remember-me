import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

if (process.env['NODE_ENV'] !== 'production') {
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
  } catch {
    // No local .env file: variables come from the environment.
  }
}

const app = await NestFactory.create(AppModule, { rawBody: true });
configureApp(app);
await app.listen(app.get<Env>(ENV).PORT, '0.0.0.0');
