import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { STRIPE_CLIENT, StripePaymentGateway } from './stripe-payment-gateway.js';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: STRIPE_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) => new Stripe(env.STRIPE_SECRET_KEY),
    },
    { provide: PaymentGateway, useClass: StripePaymentGateway },
  ],
})
export class PaymentsModule {}
