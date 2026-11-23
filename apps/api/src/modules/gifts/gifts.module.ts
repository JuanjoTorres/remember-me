import { Module } from '@nestjs/common';
import { GiftsController } from './gifts.controller.js';
import { GiftsService } from './gifts.service.js';
import { PaymentSucceededSubscriber } from './payment-succeeded.subscriber.js';
import { PublicGiftsController } from './public-gifts.controller.js';

@Module({
  controllers: [GiftsController, PublicGiftsController],
  providers: [GiftsService, PaymentSucceededSubscriber],
})
export class GiftsModule {}
