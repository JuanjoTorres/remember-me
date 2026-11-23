import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { STRIPE_CLIENT, StripePaymentGateway } from './stripe-payment-gateway.js';

function createStripeClient(env: Env): Stripe {
  if (!env.STRIPE_API_BASE_URL) return new Stripe(env.STRIPE_SECRET_KEY);
  // Automated tests talk to a local stand-in instead of api.stripe.com.
  const standIn = new URL(env.STRIPE_API_BASE_URL);
  return new Stripe(env.STRIPE_SECRET_KEY, {
    host: standIn.hostname,
    port: standIn.port,
    protocol: standIn.protocol === 'https:' ? 'https' : 'http',
    maxNetworkRetries: 0,
  });
}

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: STRIPE_CLIENT,
      inject: [ENV],
      useFactory: createStripeClient,
    },
    { provide: PaymentGateway, useClass: StripePaymentGateway },
  ],
})
export class PaymentsModule {}
