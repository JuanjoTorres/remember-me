import { Inject, Injectable } from '@nestjs/common';
import {
  type CardInput,
  checkAddCard,
  checkRevealTemplate,
  type CreateGiftRequest,
  type CreateGiftResponse,
  CustomSlugSchema,
  type GiftEditorView,
  MAX_CARDS_HARD_LIMIT,
  planOf,
  type PlanCheck,
  type PublicGift,
  RESERVED_SLUGS,
  type SlugAvailability,
  SlugSchema,
  type UpdateGiftRequest,
} from '@remember-me/shared-types';
import { GiftGrantService } from '../../shared/auth/gift-grant.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { GiftDeletedEvent } from '../../shared/events/contracts.js';
import { EventBus } from '../../shared/events/event-bus.js';
import { AppError } from '../../shared/http/app-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { editTokenMatches, generateEditToken } from './edit-token.js';
import { type GiftWithCards, toEditorView, toPublicGift } from './gift.mapper.js';
import { MediaUrlPolicy } from './media-url-policy.js';
import { generateSlug } from './slug-generator.js';

const WITH_CARDS = { cards: true } as const;
const SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertPlanAllows(check: PlanCheck, message: string): void {
  if (!check.allowed)
    throw new AppError('PREMIUM_REQUIRED', message, { capability: check.capability });
}

function missingToPublish(gift: GiftWithCards): string[] {
  return [
    ...(gift.cards.length === 0 ? ['CARDS'] : []),
    ...(gift.revealHeadline.trim() === '' ? ['REVEAL_HEADLINE'] : []),
  ];
}

/**
 * The link is fixed on first publication, so that it can carry the recipient's name. A link the
 * creator chose is kept.
 */
function publishData(gift: Pick<GiftWithCards, 'slugIsCustom' | 'recipientName'>) {
  return {
    status: 'PUBLISHED' as const,
    publishedAt: new Date(),
    ...(gift.slugIsCustom ? {} : { slug: generateSlug(gift.recipientName) }),
  };
}

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: GiftGrantService,
    private readonly events: EventBus,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(request: CreateGiftRequest): Promise<CreateGiftResponse> {
    const { token, hash } = generateEditToken();
    const gift = await this.withSlugRetry(() =>
      this.prisma.gift.create({
        data: { slug: generateSlug(''), editTokenHash: hash, locale: request.locale },
        include: WITH_CARDS,
      }),
    );
    return { gift: this.view(gift), editToken: token };
  }

  async get(giftId: string, editToken: string | undefined): Promise<GiftEditorView> {
    return this.view(await this.authorize(giftId, editToken));
  }

  async update(
    giftId: string,
    editToken: string | undefined,
    changes: UpdateGiftRequest,
  ): Promise<GiftEditorView> {
    const gift = await this.authorize(giftId, editToken);
    const { reveal } = changes;
    if (reveal?.template) {
      assertPlanAllows(
        checkRevealTemplate(planOf(gift), reveal.template),
        'This reveal is part of the full experience',
      );
    }
    if (reveal) this.mediaPolicy(giftId).assertReveal(reveal);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Locked so that a concurrent publication sees either the old or the new headline.
      const current = await this.lock(tx, giftId);
      if (current.status === 'PUBLISHED' && reveal?.headline === '') {
        throw new AppError('GIFT_INCOMPLETE', 'A published gift needs its surprise', {
          missing: ['REVEAL_HEADLINE'],
        });
      }
      return tx.gift.update({
        where: { id: giftId },
        data: {
          recipientName: changes.recipientName,
          senderName: changes.senderName,
          locale: changes.locale,
          revealTemplate: reveal?.template,
          revealHeadline: reveal?.headline,
          revealMessage: reveal?.message,
          revealDetail: reveal?.detail,
          revealImageUrl: reveal?.imageUrl,
        },
        include: WITH_CARDS,
      });
    });
    return this.view(updated);
  }

  async addCard(
    giftId: string,
    editToken: string | undefined,
    card: CardInput,
  ): Promise<GiftEditorView> {
    await this.authorize(giftId, editToken);
    this.mediaPolicy(giftId).assertCard(card);

    await this.prisma.$transaction(async (tx) => {
      // Locked so that two concurrent requests cannot both pass the card limit.
      const gift = await this.lock(tx, giftId);

      assertPlanAllows(
        checkAddCard(planOf(gift), gift.cards.length, card.type),
        'This needs the full experience',
      );
      if (gift.cards.length >= MAX_CARDS_HARD_LIMIT) {
        throw new AppError('CONFLICT', `A gift can have at most ${MAX_CARDS_HARD_LIMIT} cards`);
      }
      const lastPosition = Math.max(-1, ...gift.cards.map((existing) => existing.position));
      await tx.giftCard.create({
        data: { giftId, type: card.type, payload: card.payload, position: lastPosition + 1 },
      });
    });
    return this.view(await this.load(giftId));
  }

  async updateCard(
    giftId: string,
    editToken: string | undefined,
    cardId: string,
    card: CardInput,
  ): Promise<GiftEditorView> {
    const gift = await this.authorize(giftId, editToken);
    const existing = gift.cards.find((candidate) => candidate.id === cardId);
    if (!existing) throw new AppError('NOT_FOUND', 'Card not found');
    if (existing.type !== card.type) {
      throw new AppError('VALIDATION_ERROR', 'The type of a card cannot change');
    }
    this.mediaPolicy(giftId).assertCard(card);
    await this.prisma.giftCard.update({ where: { id: cardId }, data: { payload: card.payload } });
    return this.view(await this.load(giftId));
  }

  async removeCard(
    giftId: string,
    editToken: string | undefined,
    cardId: string,
  ): Promise<GiftEditorView> {
    await this.authorize(giftId, editToken);
    await this.prisma.$transaction(async (tx) => {
      const gift = await this.lock(tx, giftId);
      if (!gift.cards.some((card) => card.id === cardId)) {
        throw new AppError('NOT_FOUND', 'Card not found');
      }
      if (gift.status === 'PUBLISHED' && gift.cards.length === 1) {
        throw new AppError('GIFT_INCOMPLETE', 'A published gift needs at least one card', {
          missing: ['CARDS'],
        });
      }
      await tx.giftCard.delete({ where: { id: cardId } });
    });
    return this.view(await this.load(giftId));
  }

  async reorderCards(
    giftId: string,
    editToken: string | undefined,
    cardIds: string[],
  ): Promise<GiftEditorView> {
    const gift = await this.authorize(giftId, editToken);
    const current = new Set(gift.cards.map((card) => card.id));
    const sameCards =
      cardIds.length === current.size &&
      new Set(cardIds).size === current.size &&
      cardIds.every((id) => current.has(id));
    if (!sameCards) {
      throw new AppError(
        'VALIDATION_ERROR',
        'The new order must contain every card of the gift exactly once',
      );
    }
    await this.prisma.$transaction(
      cardIds.map((id, position) =>
        this.prisma.giftCard.update({ where: { id }, data: { position } }),
      ),
    );
    return this.view(await this.load(giftId));
  }

  async publish(giftId: string, editToken: string | undefined): Promise<GiftEditorView> {
    await this.authorize(giftId, editToken);
    const published = await this.withSlugRetry(() =>
      this.prisma.$transaction(async (tx) => {
        // Locked: a double tap or a payment arriving at the same time must not replace the link.
        const gift = await this.lock(tx, giftId);
        const missing = missingToPublish(gift);
        if (missing.length > 0) {
          throw new AppError('GIFT_INCOMPLETE', 'The gift is not ready to be published', {
            missing,
          });
        }
        if (gift.status === 'PUBLISHED') return gift;
        return tx.gift.update({
          where: { id: giftId },
          data: publishData(gift),
          include: WITH_CARDS,
        });
      }),
    );
    return this.view(published);
  }

  /** Lets the creator pick the custom link they paid for when the first choice was taken. */
  async changeSlug(
    giftId: string,
    editToken: string | undefined,
    slug: string,
  ): Promise<GiftEditorView> {
    const gift = await this.authorize(giftId, editToken);
    if (!gift.customSlugPending) {
      throw new AppError('PREMIUM_REQUIRED', 'A custom link is a paid extra', {
        capability: 'CUSTOM_SLUG',
      });
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await this.lock(tx, giftId);
        if (!(await this.slugIsFree(tx, slug, giftId))) {
          throw new AppError('SLUG_TAKEN', 'This link is already taken');
        }
        await this.keepOldLink(tx, current, slug);
        return tx.gift.update({
          where: { id: giftId },
          data: { slug, slugIsCustom: true, customSlugPending: false },
          include: WITH_CARDS,
        });
      });
      return this.view(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('SLUG_TAKEN', 'This link is already taken');
      throw error;
    }
  }

  async remove(giftId: string, editToken: string | undefined): Promise<void> {
    await this.authorize(giftId, editToken);
    // Announced first: if another module fails to clean up (stored media), the request fails while
    // the gift still exists, so the creator can simply try again and nothing is left behind.
    await this.events.publish(GiftDeletedEvent, { giftId });
    await this.prisma.gift.deleteMany({ where: { id: giftId } });
  }

  async slugAvailability(slug: string): Promise<SlugAvailability> {
    if (!SlugSchema.safeParse(slug).success) return { slug, available: false, reason: 'INVALID' };
    if (RESERVED_SLUGS.includes(slug)) return { slug, available: false, reason: 'RESERVED' };
    return (await this.slugIsFree(this.prisma, slug))
      ? { slug, available: true }
      : { slug, available: false, reason: 'TAKEN' };
  }

  async getPublic(slug: string): Promise<PublicGift> {
    const gift =
      (await this.prisma.gift.findUnique({ where: { slug }, include: WITH_CARDS })) ??
      // A link the gift had before it got its custom one.
      (await this.prisma.giftSlugAlias
        .findUnique({ where: { slug }, include: { gift: { include: WITH_CARDS } } })
        .then((alias) => alias?.gift ?? null));
    if (!gift || gift.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 'Gift not found');
    return toPublicGift(gift);
  }

  /**
   * Applies a confirmed payment: premium, the custom link if one was bought, and publication when
   * the gift is ready. Running it again for the same order changes nothing.
   */
  async applyPayment(orderId: string, giftId: string, customSlug: string | null): Promise<void> {
    await this.withSlugRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const gift = await tx.gift
          .findUnique({ where: { id: giftId }, select: { id: true } })
          .then((found) => (found ? this.lock(tx, giftId) : null));
        // The gift may have been deleted after paying; there is nothing left to upgrade.
        if (!gift || gift.appliedOrderIds.includes(orderId)) return;

        const wantsCustomSlug = customSlug !== null && customSlug !== gift.slug;
        const slugFree =
          wantsCustomSlug &&
          CustomSlugSchema.safeParse(customSlug).success &&
          (await this.slugIsFree(tx, customSlug, giftId));
        if (slugFree) await this.keepOldLink(tx, gift, customSlug);

        await tx.gift.update({
          where: { id: giftId },
          data: {
            isPremium: true,
            appliedOrderIds: { push: orderId },
            ...(slugFree
              ? { slug: customSlug, slugIsCustom: true, customSlugPending: false }
              : // Someone took the link between checkout and payment: the creator picks another.
                { customSlugPending: wantsCustomSlug ? true : gift.customSlugPending }),
            ...(gift.status === 'DRAFT' && missingToPublish(gift).length === 0
              ? publishData({ ...gift, slugIsCustom: gift.slugIsCustom || slugFree })
              : {}),
          },
        });
      }),
    );
  }

  private async authorize(giftId: string, editToken: string | undefined): Promise<GiftWithCards> {
    const gift = await this.prisma.gift.findUnique({ where: { id: giftId }, include: WITH_CARDS });
    if (!gift) throw new AppError('NOT_FOUND', 'Gift not found');
    if (!editToken || !editTokenMatches(editToken, gift.editTokenHash)) {
      throw new AppError('UNAUTHORIZED', 'A valid edit token is required');
    }
    return gift;
  }

  private async load(giftId: string): Promise<GiftWithCards> {
    const gift = await this.prisma.gift.findUnique({ where: { id: giftId }, include: WITH_CARDS });
    if (!gift) throw new AppError('NOT_FOUND', 'Gift not found');
    return gift;
  }

  /** Reads the gift inside a transaction while holding a row lock on it. */
  private async lock(tx: Prisma.TransactionClient, giftId: string): Promise<GiftWithCards> {
    await tx.$queryRaw`SELECT id FROM gifts WHERE id = ${giftId}::uuid FOR UPDATE`;
    const gift = await tx.gift.findUnique({ where: { id: giftId }, include: WITH_CARDS });
    if (!gift) throw new AppError('NOT_FOUND', 'Gift not found');
    return gift;
  }

  /** A slug is free when no gift uses it now and no other gift used it before. */
  private async slugIsFree(
    db: Prisma.TransactionClient | PrismaService,
    slug: string,
    forGiftId?: string,
  ): Promise<boolean> {
    const [gift, alias] = await Promise.all([
      db.gift.findUnique({ where: { slug }, select: { id: true } }),
      db.giftSlugAlias.findUnique({ where: { slug } }),
    ]);
    return (
      (gift === null || gift.id === forGiftId) && (alias === null || alias.giftId === forGiftId)
    );
  }

  /** Before a published gift changes its link, the old one is kept as an alias. */
  private async keepOldLink(
    tx: Prisma.TransactionClient,
    gift: GiftWithCards,
    newSlug: string,
  ): Promise<void> {
    // Going back to a link the gift already had: it stops being an alias.
    await tx.giftSlugAlias.deleteMany({ where: { slug: newSlug, giftId: gift.id } });
    if (gift.status !== 'PUBLISHED' || gift.slug === newSlug) return;
    await tx.giftSlugAlias.upsert({
      where: { slug: gift.slug },
      create: { slug: gift.slug, giftId: gift.id },
      update: {},
    });
  }

  /** Runs a write that generates a slug, again if the slug happened to be taken. */
  private async withSlugRetry<T>(write: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await write();
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= SLUG_ATTEMPTS) throw error;
      }
    }
  }

  private mediaPolicy(giftId: string): MediaUrlPolicy {
    return new MediaUrlPolicy(this.env.MEDIA_PUBLIC_URL, giftId);
  }

  private view(gift: GiftWithCards): GiftEditorView {
    const grant = this.grants.issue({
      giftId: gift.id,
      slug: gift.slug,
      plan: planOf(gift),
      published: gift.status === 'PUBLISHED',
    });
    return toEditorView(gift, this.env.WEB_ORIGIN, grant);
  }
}
