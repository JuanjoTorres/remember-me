import type { INestApplication } from '@nestjs/common';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

/** HTTP-level setup shared by the real server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.enableCors({ origin: env.WEB_ORIGIN });
  app.enableShutdownHooks();
}
