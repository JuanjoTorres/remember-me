import {
  type Card,
  CardSchema,
  editableUntil,
  type GiftEditorView,
  type Locale,
  LocaleSchema,
  PLAN_CAPABILITIES,
  planOf,
  proFeaturesOf,
  type PublicGift,
  type Reveal,
} from '@remember-me/shared-types';
import type { Gift, GiftCard } from '../../generated/prisma/client.js';

export type GiftWithCards = Gift & { cards: GiftCard[] };

function toCards(cards: GiftCard[]): Card[] {
  return [...cards]
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
    .map((card, index) =>
      CardSchema.parse({ id: card.id, position: index, type: card.type, payload: card.payload }),
    );
}

function toReveal(gift: Gift): Reveal {
  return {
    template: gift.revealTemplate,
    headline: gift.revealHeadline,
    message: gift.revealMessage,
    detail: gift.revealDetail,
    imageUrl: gift.revealImageUrl,
  };
}

function toLocale(value: string): Locale {
  return LocaleSchema.catch('en').parse(value);
}

export function publicUrlOf(webOrigin: string, slug: string): string {
  return `${webOrigin}/for/${slug}`;
}

/** End of the correction window. `null` while the gift is a draft that nobody locked. */
export function editableUntilOf(gift: Gift): Date | null {
  if (gift.status === 'PUBLISHED' && gift.publishedAt) {
    return editableUntil(gift.publishedAt, gift.lockedAt);
  }
  return gift.lockedAt;
}

/**
 * Whether the gift no longer accepts new editing sessions: its correction window ended, or it was
 * locked.
 */
export function isLocked(gift: Gift, now: Date): boolean {
  const until = editableUntilOf(gift);
  return until !== null && until <= now;
}

/** Whether the gift was locked by hand, which also ends the editing sessions that are open. */
export function isLockedByHand(gift: Gift, now: Date): boolean {
  return gift.lockedAt !== null && gift.lockedAt <= now;
}

export function toEditorView(
  gift: GiftWithCards,
  webOrigin: string,
  grant: { grant: string; expiresAt: Date },
  /** Whether whoever asks can no longer edit the gift. */
  locked: boolean,
): GiftEditorView {
  const plan = planOf(gift);
  const cards = toCards(gift.cards);
  const reveal = toReveal(gift);
  return {
    id: gift.id,
    slug: gift.slug,
    status: gift.status,
    plan,
    capabilities: PLAN_CAPABILITIES[plan],
    locale: toLocale(gift.locale),
    recipientName: gift.recipientName,
    senderName: gift.senderName,
    reveal,
    cards,
    proFeatures: proFeaturesOf({ cards, reveal }),
    publishedAt: gift.publishedAt?.toISOString() ?? null,
    editableUntil: editableUntilOf(gift)?.toISOString() ?? null,
    locked,
    expiresAt: gift.expiresAt?.toISOString() ?? null,
    customSlugPending: gift.customSlugPending,
    publicUrl: publicUrlOf(webOrigin, gift.slug),
    grant: grant.grant,
    grantExpiresAt: grant.expiresAt.toISOString(),
  };
}

export function toPublicGift(gift: GiftWithCards): PublicGift {
  return {
    slug: gift.slug,
    locale: toLocale(gift.locale),
    recipientName: gift.recipientName,
    senderName: gift.senderName,
    cards: toCards(gift.cards),
    reveal: toReveal(gift),
    watermark: PLAN_CAPABILITIES[planOf(gift)].watermark,
  };
}
