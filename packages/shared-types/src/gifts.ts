import { z } from 'zod';
import {
  CardTypeSchema,
  PlanCapabilitiesSchema,
  PlanSchema,
  ProFeatureSchema,
  RevealTemplateSchema,
} from './plans.js';
import { CustomSlugSchema } from './slug.js';

export const LocaleSchema = z.enum(['en', 'es']);
export type Locale = z.infer<typeof LocaleSchema>;

export const GiftStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);
export type GiftStatus = z.infer<typeof GiftStatusSchema>;

/** PostgreSQL cannot store NUL in text, so it is rejected at the edge. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes('\u0000'), { message: 'Invalid character' });
const requiredText = (max: number) => text(max).min(1);
/** URL of a file previously uploaded through the media endpoint. */
const mediaUrl = z.url({ protocol: /^https?$/ }).max(500);

export const CARD_TEXT_MAX = 280;

// --- Card payloads -------------------------------------------------------------------------

export const PhotoTextPayloadSchema = z
  .object({
    imageUrl: mediaUrl.nullable().default(null),
    text: text(CARD_TEXT_MAX).default(''),
  })
  .refine((payload) => payload.imageUrl !== null || payload.text.length > 0, {
    message: 'A card needs a photo or some text',
  });
export type PhotoTextPayload = z.infer<typeof PhotoTextPayloadSchema>;

export const AudioNotePayloadSchema = z.object({
  audioUrl: mediaUrl,
  imageUrl: mediaUrl.nullable().default(null),
  caption: text(140).default(''),
});
export type AudioNotePayload = z.infer<typeof AudioNotePayloadSchema>;

export const TriviaPayloadSchema = z
  .object({
    question: requiredText(140),
    options: z.array(requiredText(60)).min(2).max(4),
    correctIndex: z.number().int().min(0),
    successMessage: text(140).default(''),
  })
  .refine((payload) => payload.correctIndex < payload.options.length, {
    message: 'The correct answer must be one of the options',
    path: ['correctIndex'],
  });
export type TriviaPayload = z.infer<typeof TriviaPayloadSchema>;

/** A card as sent by the editor: its type decides the shape of the payload. */
export const CardInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PHOTO_TEXT'), payload: PhotoTextPayloadSchema }),
  z.object({ type: z.literal('AUDIO_NOTE'), payload: AudioNotePayloadSchema }),
  z.object({ type: z.literal('TRIVIA'), payload: TriviaPayloadSchema }),
]);
export type CardInput = z.infer<typeof CardInputSchema>;

const cardBase = { id: z.uuid(), position: z.number().int().min(0) };
export const CardSchema = z.discriminatedUnion('type', [
  z.object({ ...cardBase, type: z.literal('PHOTO_TEXT'), payload: PhotoTextPayloadSchema }),
  z.object({ ...cardBase, type: z.literal('AUDIO_NOTE'), payload: AudioNotePayloadSchema }),
  z.object({ ...cardBase, type: z.literal('TRIVIA'), payload: TriviaPayloadSchema }),
]);
export type Card = z.infer<typeof CardSchema>;

export const ReorderCardsRequestSchema = z.object({ cardIds: z.array(z.uuid()).min(1) });
export type ReorderCardsRequest = z.infer<typeof ReorderCardsRequestSchema>;

// --- Gift ----------------------------------------------------------------------------------

export const RevealSchema = z.object({
  template: RevealTemplateSchema,
  /** The surprise itself, e.g. "We are going to Lisbon". */
  headline: text(60),
  message: text(500),
  /** Short line shown as a detail, e.g. a date or a booking code. */
  detail: text(60),
  imageUrl: mediaUrl.nullable(),
});
export type Reveal = z.infer<typeof RevealSchema>;

export const CreateGiftRequestSchema = z.object({ locale: LocaleSchema.default('en') });
export type CreateGiftRequest = z.infer<typeof CreateGiftRequestSchema>;

export const UpdateGiftRequestSchema = z
  .object({
    recipientName: text(40),
    senderName: text(40),
    locale: LocaleSchema,
    reveal: RevealSchema.partial(),
  })
  .partial();
export type UpdateGiftRequest = z.infer<typeof UpdateGiftRequestSchema>;

export const ChangeSlugRequestSchema = z.object({ slug: CustomSlugSchema });
export type ChangeSlugRequest = z.infer<typeof ChangeSlugRequestSchema>;

/** The gift as its creator sees it. Requires the edit token. */
export const GiftEditorViewSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  status: GiftStatusSchema,
  plan: PlanSchema,
  capabilities: PlanCapabilitiesSchema,
  locale: LocaleSchema,
  recipientName: z.string(),
  senderName: z.string(),
  reveal: RevealSchema,
  cards: z.array(CardSchema),
  /** Paid features the content uses. A free gift that has any must be paid for to be published. */
  proFeatures: z.array(ProFeatureSchema),
  publishedAt: z.iso.datetime().nullable(),
  /** Until when a published gift can still be corrected. `null` for a draft. */
  editableUntil: z.iso.datetime().nullable(),
  /** The correction window is over: nothing can be edited any more, only deleted. */
  locked: z.boolean(),
  /** When the gift and its files are deleted. `null` means never (a paid gift). */
  expiresAt: z.iso.datetime().nullable(),
  /** A paid custom link could not be applied (it was taken); the creator may choose another. */
  customSlugPending: z.boolean(),
  /** Public URL of the gift. Only meaningful once published. */
  publicUrl: z.url(),
  /** Short-lived credential for the media, QR and payment endpoints of this gift. */
  grant: z.string(),
  grantExpiresAt: z.iso.datetime(),
});
export type GiftEditorView = z.infer<typeof GiftEditorViewSchema>;

export const CreateGiftResponseSchema = z.object({
  gift: GiftEditorViewSchema,
  /** Secret that gives edit access. Returned only once, on creation. */
  editToken: z.string(),
});
export type CreateGiftResponse = z.infer<typeof CreateGiftResponseSchema>;

/** The gift as the recipient sees it. Only published gifts are served. */
export const PublicGiftSchema = z.object({
  slug: z.string(),
  locale: LocaleSchema,
  recipientName: z.string(),
  senderName: z.string(),
  cards: z.array(CardSchema),
  reveal: RevealSchema,
  watermark: z.boolean(),
});
export type PublicGift = z.infer<typeof PublicGiftSchema>;

export const EDIT_TOKEN_HEADER = 'x-edit-token';
/**
 * Carries the grant of the last answer back to the editor endpoints. It proves that the editor was
 * opened while the gift could still be edited, which keeps that session editing after the window.
 */
export const EDIT_SESSION_HEADER = 'x-edit-session';

export { CardTypeSchema };
