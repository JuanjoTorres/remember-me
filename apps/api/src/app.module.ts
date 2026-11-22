import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { GiftsModule } from './modules/gifts/gifts.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { QrModule } from './modules/qr/qr.module.js';
import { PrismaModule } from './shared/prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, GiftsModule, MediaModule, QrModule, PaymentsModule],
  controllers: [HealthController],
})
export class AppModule {}
