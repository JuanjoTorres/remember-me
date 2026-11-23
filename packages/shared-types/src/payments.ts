import { z } from 'zod';
import { CustomSlugSchema } from './slug.js';

const redirectUrl = z.url({ protocol: /^https?$/ }).max(500);

export const CheckoutSessionRequestSchema = z
  .object({
    giftId: z.uuid(),
    /** Order bump: buy a custom link together with the full experience. */
    includeCustomSlug: z.boolean().default(false),
    customSlug: CustomSlugSchema.optional(),
    successUrl: redirectUrl,
    cancelUrl: redirectUrl,
  })
  .refine((request) => !request.includeCustomSlug || request.customSlug !== undefined, {
    message: 'Choose the custom link',
    path: ['customSlug'],
  });
export type CheckoutSessionRequest = z.infer<typeof CheckoutSessionRequestSchema>;

export const CheckoutSessionResponseSchema = z.object({
  orderId: z.uuid(),
  /** Stripe Checkout page to send the browser to. */
  checkoutUrl: z.url(),
});
export type CheckoutSessionResponse = z.infer<typeof CheckoutSessionResponseSchema>;

export const PriceSchema = z.object({
  /** In the smallest currency unit (cents). */
  amount: z.number().int().nonnegative(),
  /** ISO 4217, lowercase, as Stripe reports it. */
  currency: z.string().length(3),
});
export type Price = z.infer<typeof PriceSchema>;

/** Current prices, read from Stripe. The UI never hard-codes an amount. */
export const PricesResponseSchema = z.object({ premium: PriceSchema, customSlug: PriceSchema });
export type PricesResponse = z.infer<typeof PricesResponseSchema>;

/** Result of asking Stripe directly whether the open checkout of a gift has been paid. */
export const PaymentConfirmationSchema = z.object({
  status: z.enum(['PAID', 'PENDING', 'NONE']),
});
export type PaymentConfirmation = z.infer<typeof PaymentConfirmationSchema>;
