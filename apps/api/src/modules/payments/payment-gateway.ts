import type { Price } from '@remember-me/shared-types';

export interface CheckoutSessionParams {
  orderId: string;
  giftId: string;
  priceIds: string[];
  customSlug: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** State of a checkout session, as read from the provider. */
export interface CheckoutSessionState {
  sessionId: string;
  paid: boolean;
  /** The session can no longer be paid. */
  expired: boolean;
  amountTotal: number | null;
  currency: string | null;
  customerEmail: string | null;
}

/** What the payment provider told us in a verified webhook, reduced to what this module uses. */
export type PaymentEvent =
  | { id: string; type: string; kind: 'ignored' }
  | {
      id: string;
      type: string;
      kind: 'paid' | 'expired';
      sessionId: string;
      orderId: string | null;
      amountTotal: number | null;
      currency: string | null;
      customerEmail: string | null;
    };

/** The payment provider, as this module needs it. Stripe is the only implementation. */
export abstract class PaymentGateway {
  abstract createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession>;
  /** Makes a session unpayable. Resolves quietly if it was already completed or expired. */
  abstract expireCheckoutSession(sessionId: string): Promise<void>;
  abstract getCheckoutSession(sessionId: string): Promise<CheckoutSessionState>;
  abstract getPrice(priceId: string): Promise<Price>;
  /** Verifies the signature of a webhook delivery. Throws `AppError` when it is not authentic. */
  abstract parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent;
}
