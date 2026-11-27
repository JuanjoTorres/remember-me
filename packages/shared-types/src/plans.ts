import { z } from 'zod';

export const PlanSchema = z.enum(['FREE', 'PREMIUM']);
export type Plan = z.infer<typeof PlanSchema>;

export const CardTypeSchema = z.enum(['PHOTO_TEXT', 'AUDIO_NOTE', 'TRIVIA']);
export type CardType = z.infer<typeof CardTypeSchema>;

export const RevealTemplateSchema = z.enum(['BASIC', 'SCRATCH_CARD', 'TICKET', 'GIFT_BOX']);
export type RevealTemplate = z.infer<typeof RevealTemplateSchema>;

export const QrFormatSchema = z.enum(['png', 'svg']);
export type QrFormat = z.infer<typeof QrFormatSchema>;

export const PlanCapabilitiesSchema = z.object({
  /** Maximum number of cards in a gift. `null` means no plan limit. */
  maxCards: z.number().int().positive().nullable(),
  cardTypes: z.array(CardTypeSchema),
  revealTemplates: z.array(RevealTemplateSchema),
  /** Whether "Created with kardoo.me" is shown at the end of the experience. */
  watermark: z.boolean(),
  qrFormats: z.array(QrFormatSchema),
  /** Edge length in pixels of the downloadable PNG QR code. */
  qrPngSize: z.number().int().positive(),
});
export type PlanCapabilities = z.infer<typeof PlanCapabilitiesSchema>;

/** Single source of truth for what each plan can do. Enforced by the API, mirrored by the UI. */
export const PLAN_CAPABILITIES: Readonly<Record<Plan, PlanCapabilities>> = {
  FREE: {
    maxCards: 3,
    cardTypes: ['PHOTO_TEXT'],
    revealTemplates: ['BASIC'],
    watermark: true,
    qrFormats: ['png'],
    qrPngSize: 512,
  },
  PREMIUM: {
    maxCards: null,
    cardTypes: ['PHOTO_TEXT', 'AUDIO_NOTE', 'TRIVIA'],
    revealTemplates: ['BASIC', 'SCRATCH_CARD', 'TICKET', 'GIFT_BOX'],
    watermark: false,
    qrFormats: ['png', 'svg'],
    qrPngSize: 2048,
  },
};

/** Technical ceiling that protects the service; it is not a plan feature. */
export const MAX_CARDS_HARD_LIMIT = 60;

export function planOf(gift: { isPremium: boolean }): Plan {
  return gift.isPremium ? 'PREMIUM' : 'FREE';
}

/** What a paid capability check ran into. Sent with `PREMIUM_REQUIRED` so the UI can explain it. */
export const PremiumCapabilitySchema = z.enum([
  'MAX_CARDS',
  'CARD_TYPE',
  'REVEAL_TEMPLATE',
  'AUDIO_UPLOAD',
  'QR_FORMAT',
  'CUSTOM_SLUG',
  /** Publishing a gift whose content uses paid features. */
  'PRO_FEATURES',
]);
export type PremiumCapability = z.infer<typeof PremiumCapabilitySchema>;

export type PlanCheck = { allowed: true } | { allowed: false; capability: PremiumCapability };

const ALLOWED: PlanCheck = { allowed: true };

export function checkAddCard(plan: Plan, currentCardCount: number, type: CardType): PlanCheck {
  const capabilities = PLAN_CAPABILITIES[plan];
  if (!capabilities.cardTypes.includes(type)) return { allowed: false, capability: 'CARD_TYPE' };
  if (capabilities.maxCards !== null && currentCardCount >= capabilities.maxCards) {
    return { allowed: false, capability: 'MAX_CARDS' };
  }
  return ALLOWED;
}

export function checkRevealTemplate(plan: Plan, template: RevealTemplate): PlanCheck {
  return PLAN_CAPABILITIES[plan].revealTemplates.includes(template)
    ? ALLOWED
    : { allowed: false, capability: 'REVEAL_TEMPLATE' };
}

export function checkQrFormat(plan: Plan, format: QrFormat): PlanCheck {
  return PLAN_CAPABILITIES[plan].qrFormats.includes(format)
    ? ALLOWED
    : { allowed: false, capability: 'QR_FORMAT' };
}

/** A paid feature that the content of a gift uses. A draft may use them all; publishing needs the plan. */
export const ProFeatureSchema = z.enum(['EXTRA_CARDS', 'VOICE_NOTE', 'TRIVIA', 'PREMIUM_REVEAL']);
export type ProFeature = z.infer<typeof ProFeatureSchema>;

const PRO_FEATURE_OF_CARD: Partial<Record<CardType, ProFeature>> = {
  AUDIO_NOTE: 'VOICE_NOTE',
  TRIVIA: 'TRIVIA',
};

/** The paid features a gift relies on: what the free plan would not allow in it. */
export function proFeaturesOf(gift: {
  cards: readonly { type: CardType }[];
  reveal: { template: RevealTemplate };
}): ProFeature[] {
  const free = PLAN_CAPABILITIES.FREE;
  const used = new Set<ProFeature>();
  if (free.maxCards !== null && gift.cards.length > free.maxCards) used.add('EXTRA_CARDS');
  for (const card of gift.cards) {
    const feature = PRO_FEATURE_OF_CARD[card.type];
    if (feature && !free.cardTypes.includes(card.type)) used.add(feature);
  }
  if (!free.revealTemplates.includes(gift.reveal.template)) used.add('PREMIUM_REVEAL');
  return ProFeatureSchema.options.filter((feature) => used.has(feature));
}
