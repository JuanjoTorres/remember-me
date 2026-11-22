import { z } from 'zod';
import { PremiumCapabilitySchema } from './plans.js';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'PREMIUM_REQUIRED',
  'SLUG_TAKEN',
  'GIFT_INCOMPLETE',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const PremiumRequiredDetailsSchema = z.object({ capability: PremiumCapabilitySchema });
export type PremiumRequiredDetails = z.infer<typeof PremiumRequiredDetailsSchema>;

/** Body of every non-2xx API response. */
export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
