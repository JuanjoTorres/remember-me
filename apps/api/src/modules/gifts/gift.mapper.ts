import {
  type Card,
  CardSchema,
  type GiftEditorView,
  type Locale,
  LocaleSchema,
  PLAN_CAPABILITIES,
  planOf,
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

export function toEditorView(
  gift: GiftWithCards,
  webOrigin: string,
  grant: { grant: string; expiresAt: Date },
): GiftEditorView {
  const plan = planOf(gift);
  return {
    id: gift.id,
    slug: gift.slug,
    status: gift.status,
    plan,
    capabilities: PLAN_CAPABILITIES[plan],
    locale: toLocale(gift.locale),
    recipientName: gift.recipientName,
    senderName: gift.senderName,
    reveal: toReveal(gift),
    cards: toCards(gift.cards),
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
