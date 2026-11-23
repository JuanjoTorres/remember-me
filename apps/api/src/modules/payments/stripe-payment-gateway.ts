import { Inject, Injectable } from '@nestjs/common';
import type { Price } from '@remember-me/shared-types';
import Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/http/app-error.js';
import {
  type CheckoutSession,
  type CheckoutSessionParams,
  type CheckoutSessionState,
  type PaymentEvent,
  PaymentGateway,
} from './payment-gateway.js';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

@Injectable()
export class StripePaymentGateway extends PaymentGateway {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession> {
    const metadata = {
      orderId: params.orderId,
      giftId: params.giftId,
      customSlug: params.customSlug ?? '',
    };
    // No payment method list: Stripe shows the methods enabled in the Dashboard that fit the
    // customer (cards, Apple Pay, Google Pay, Bizum...). Listing them here is no longer accepted.
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: params.priceIds.map((price) => ({ price, quantity: 1 })),
        client_reference_id: params.orderId,
        metadata,
        payment_intent_data: { metadata },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      { idempotencyKey: `checkout-${params.orderId}` },
    );
    if (!session.url) throw new AppError('INTERNAL', 'Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      // Stripe refuses to expire a session that is no longer open, which is the state we want.
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
    }
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSessionState> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return {
      sessionId: session.id,
      paid: session.payment_status === 'paid',
      expired: session.status === 'expired',
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
    };
  }

  async getPrice(priceId: string): Promise<Price> {
    const price = await this.stripe.prices.retrieve(priceId);
    if (price.unit_amount === null)
      throw new AppError('INTERNAL', `Price ${priceId} has no amount`);
    return { amount: price.unit_amount, currency: price.currency };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature ?? '',
        this.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new AppError('UNAUTHORIZED', 'Invalid webhook signature');
    }

    const base = { id: event.id, type: event.type };
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        // A completed session with a delayed payment method is not paid yet; the
        // async_payment_succeeded event follows when the money arrives.
        if (session.payment_status !== 'paid') return { ...base, kind: 'ignored' };
        return { ...base, kind: 'paid', ...sessionFacts(session) };
      }
      // A delayed payment that failed leaves the session as unusable as an expired one.
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { ...base, kind: 'expired', ...sessionFacts(event.data.object) };
      default:
        return { ...base, kind: 'ignored' };
    }
  }
}

function sessionFacts(session: Stripe.Checkout.Session) {
  return {
    sessionId: session.id,
    orderId: session.metadata?.['orderId'] ?? session.client_reference_id ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
  };
}
