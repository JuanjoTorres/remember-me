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
    const gift = await this.withFreshSlug('', (slug) =>
      this.prisma.gift.create({
        data: { slug, editTokenHash: hash, locale: request.locale },
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

    const updated = await this.prisma.gift.update({
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
      // Lock the gift so that two concurrent requests cannot both pass the card limit.
      await tx.$queryRaw`SELECT id FROM gifts WHERE id = ${giftId}::uuid FOR UPDATE`;
      const gift = await tx.gift.findUnique({ where: { id: giftId }, include: WITH_CARDS });
      if (!gift) throw new AppError('NOT_FOUND', 'Gift not found');

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
    const { count } = await this.prisma.giftCard.deleteMany({ where: { id: cardId, giftId } });
    if (count === 0) throw new AppError('NOT_FOUND', 'Card not found');
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
    const gift = await this.authorize(giftId, editToken);
    const missing = [
      ...(gift.cards.length === 0 ? ['CARDS'] : []),
      ...(gift.revealHeadline.trim() === '' ? ['REVEAL_HEADLINE'] : []),
    ];
    if (missing.length > 0) {
      throw new AppError('GIFT_INCOMPLETE', 'The gift is not ready to be published', { missing });
    }
    if (gift.status === 'PUBLISHED') return this.view(gift);

    // The link is fixed on first publication, so it can carry the recipient's name.
    const publish = (slug: string) =>
      this.prisma.gift.update({
        where: { id: giftId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), slug },
        include: WITH_CARDS,
      });
    const published = gift.slugIsCustom
      ? await publish(gift.slug)
      : await this.withFreshSlug(gift.recipientName, publish);
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
      const updated = await this.prisma.gift.update({
        where: { id: giftId },
        data: { slug, slugIsCustom: true, customSlugPending: false },
        include: WITH_CARDS,
      });
      return this.view(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('SLUG_TAKEN', 'This link is already taken');
      throw error;
    }
  }

  async remove(giftId: string, editToken: string | undefined): Promise<void> {
    await this.authorize(giftId, editToken);
    await this.prisma.gift.delete({ where: { id: giftId } });
    await this.events.publish(GiftDeletedEvent, { giftId });
  }

  async slugAvailability(slug: string): Promise<SlugAvailability> {
    if (!SlugSchema.safeParse(slug).success) return { slug, available: false, reason: 'INVALID' };
    if (RESERVED_SLUGS.includes(slug)) return { slug, available: false, reason: 'RESERVED' };
    const taken = await this.prisma.gift.findUnique({ where: { slug }, select: { id: true } });
    return taken ? { slug, available: false, reason: 'TAKEN' } : { slug, available: true };
  }

  async getPublic(slug: string): Promise<PublicGift> {
    const gift = await this.prisma.gift.findUnique({ where: { slug }, include: WITH_CARDS });
    if (!gift || gift.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 'Gift not found');
    return toPublicGift(gift);
  }

  /**
   * Applies a confirmed payment. Safe to run more than once for the same payment: the gift ends up
   * in the same state.
   */
  async applyPayment(giftId: string, customSlug: string | null): Promise<void> {
    const gift = await this.prisma.gift.findUnique({ where: { id: giftId } });
    // The gift may have been deleted after paying; there is nothing left to upgrade.
    if (!gift) return;

    await this.prisma.gift.update({ where: { id: giftId }, data: { isPremium: true } });
    if (customSlug === null || gift.slug === customSlug) return;

    const valid = CustomSlugSchema.safeParse(customSlug).success;
    try {
      if (!valid) throw new AppError('SLUG_TAKEN', 'Invalid custom link');
      await this.prisma.gift.update({
        where: { id: giftId },
        data: { slug: customSlug, slugIsCustom: true, customSlugPending: false },
      });
    } catch (error) {
      if (!isUniqueViolation(error) && !(error instanceof AppError)) throw error;
      // Someone took the link between checkout and payment: the creator chooses another for free.
      await this.prisma.gift.update({ where: { id: giftId }, data: { customSlugPending: true } });
    }
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

  private async withFreshSlug<T>(
    recipientName: string,
    write: (slug: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await write(generateSlug(recipientName));
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
