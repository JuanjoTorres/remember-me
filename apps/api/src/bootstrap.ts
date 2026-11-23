import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { AppExceptionFilter } from './shared/http/app-exception.filter.js';

/** HTTP-level setup shared by the real server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  // The API only serves JSON and files to the web app; the default hardening headers all apply,
  // except that the QR image must be loadable from the web origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  (app as NestExpressApplication).set('trust proxy', env.TRUST_PROXY_HOPS);
  app.enableCors({ origin: env.WEB_ORIGIN });
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableShutdownHooks();
}
