import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
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
