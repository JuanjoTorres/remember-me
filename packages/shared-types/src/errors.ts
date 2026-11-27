import { z } from 'zod';
import { PremiumCapabilitySchema, ProFeatureSchema } from './plans.js';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'PREMIUM_REQUIRED',
  'GIFT_INCOMPLETE',
  'GIFT_LOCKED',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const PremiumRequiredDetailsSchema = z.object({
  capability: PremiumCapabilitySchema,
  /** With `PRO_FEATURES`: the paid features the gift uses. */
  proFeatures: z.array(ProFeatureSchema).optional(),
});
export type PremiumRequiredDetails = z.infer<typeof PremiumRequiredDetailsSchema>;

/**
 * Why an edit was refused with `GIFT_LOCKED`: the recipient's name is fixed on publication, and
 * everything else once the correction window has passed.
 */
export const GiftLockedDetailsSchema = z.object({ scope: z.enum(['RECIPIENT_NAME', 'GIFT']) });
export type GiftLockedDetails = z.infer<typeof GiftLockedDetailsSchema>;

/** Body of every non-2xx API response. */
export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
