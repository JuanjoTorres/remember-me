import { Module } from '@nestjs/common';
import { GiftLifecycleCron } from './gift-lifecycle.cron.js';
import { GiftLifecycleService } from './gift-lifecycle.service.js';
import { GiftsController } from './gifts.controller.js';
import { GiftsService } from './gifts.service.js';
import { LinkGuessGuard } from './link-guess-guard.js';
import { PaymentSucceededSubscriber } from './payment-succeeded.subscriber.js';
import { PublicGiftsController } from './public-gifts.controller.js';

@Module({
  controllers: [GiftsController, PublicGiftsController],
  providers: [
    LinkGuessGuard,
    GiftsService,
    GiftLifecycleService,
    GiftLifecycleCron,
    PaymentSucceededSubscriber,
  ],
})
export class GiftsModule {}
