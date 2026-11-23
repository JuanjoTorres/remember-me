import { type ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { ConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { GiftsModule } from './modules/gifts/gifts.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { QrModule } from './modules/qr/qr.module.js';
import { AuthModule } from './shared/auth/auth.module.js';
import { EventsModule } from './shared/events/events.module.js';
import { PrismaModule } from './shared/prisma/prisma.module.js';

function isGiftCreation(request: Request): boolean {
  return request.method === 'POST' && request.path === '/gifts';
}

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [
        { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
        {
          // Starting a gift needs no credentials, so it gets its own, much lower ceiling.
          name: 'gift-creation',
          ttl: 60 * 60_000,
          limit: env.GIFT_CREATION_LIMIT_PER_HOUR,
          skipIf: (context: ExecutionContext) =>
            !isGiftCreation(context.switchToHttp().getRequest()),
        },
      ],
    }),
    PrismaModule,
    EventsModule,
    AuthModule,
    GiftsModule,
    MediaModule,
    QrModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
