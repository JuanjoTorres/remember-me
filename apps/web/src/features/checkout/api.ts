import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  PaymentConfirmation,
  PricesResponse,
  SlugAvailability,
} from '@remember-me/shared-types';
import { apiJson } from '@/features/shared/api/client';

export function getPrices(): Promise<PricesResponse> {
  return apiJson('/payments/prices');
}

export function getSlugAvailability(slug: string, signal?: AbortSignal): Promise<SlugAvailability> {
  return apiJson(`/gifts/slug-availability?slug=${encodeURIComponent(slug)}`, { signal });
}

export function createCheckoutSession(
  grant: string,
  request: CheckoutSessionRequest,
): Promise<CheckoutSessionResponse> {
  return apiJson('/payments/checkout-session', { method: 'POST', body: request, grant });
}

/** Asks the API to check with Stripe whether this gift's checkout was paid, and to fulfil it. */
export function confirmPayment(grant: string): Promise<PaymentConfirmation> {
  return apiJson('/payments/confirm', { method: 'POST', grant });
}
