import { z } from 'zod';
import { defineEvent } from './event-bus.js';

/** A Stripe Checkout payment for a gift was confirmed by a verified webhook. */
export const PaymentSucceededEvent = defineEvent(
  'payment.succeeded',
  z.object({
    orderId: z.string(),
    giftId: z.uuid(),
    /** Custom link bought with the order bump, if any. */
    customSlug: z.string().nullable(),
  }),
);
export type PaymentSucceededPayload = z.infer<typeof PaymentSucceededEvent.schema>;

/** A gift and its cards were deleted by their creator. */
export const GiftDeletedEvent = defineEvent('gift.deleted', z.object({ giftId: z.uuid() }));
export type GiftDeletedPayload = z.infer<typeof GiftDeletedEvent.schema>;

/** A confirmed payment could not be applied to its gift, so the money has to be returned. */
export const PaymentUnappliedEvent = defineEvent(
  'payment.unapplied',
  z.object({ orderId: z.string(), giftId: z.uuid(), reason: z.enum(['GIFT_NOT_FOUND']) }),
);
export type PaymentUnappliedPayload = z.infer<typeof PaymentUnappliedEvent.schema>;
