import { Inject, Injectable } from '@nestjs/common';
import {
  type CardInput,
  checkAddCard,
  checkRevealTemplate,
  type CreateGiftRequest,
  type CreateGiftResponse,
  CustomNameSchema,
  draftExpiry,
  freeGiftExpiry,
  type GiftEditorView,
  type GiftLockedDetails,
  MAX_CARDS_HARD_LIMIT,
  planOf,
  type PlanCheck,
  proFeaturesOf,
  type PublicGift,
  parseLink,
  type UpdateGiftRequest,
} from '@remember-me/shared-types';
import { GiftGrantService } from '../../shared/auth/gift-grant.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { GiftDeletedEvent, PaymentUnappliedEvent } from '../../shared/events/contracts.js';
import { EventBus } from '../../shared/events/event-bus.js';
import { AppError } from '../../shared/http/app-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { editTokenMatches, generateEditToken } from './edit-token.js';
import {
  type GiftWithCards,
  isLocked,
  isLockedByHand,
  toEditorView,
  toPublicGift,
} from './gift.mapper.js';
import { MediaUrlPolicy } from './media-url-policy.js';
import { generateCustomLink, generateSlug } from './slug-generator.js';

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

function locked(scope: GiftLockedDetails['scope'], message: string): AppError {
  const details: GiftLockedDetails = { scope };
  return new AppError('GIFT_LOCKED', message, details);
}

/** What a request to the editor endpoints presents. */
export interface EditAccess {
  /** The gift's edit token. */
  editToken?: string;
  /** The grant of the last answer, when the editor sends it back (`EDIT_SESSION_HEADER`). */
  session?: string;
}

/**
 * A draft may use every feature: the plan is settled when the gift is published. From then on the
 * limits of its plan apply to every change.
 */
function planApplies(gift: GiftWithCards): boolean {
  return gift.status === 'PUBLISHED';
}

/**
 * Publishing keeps the link the gift was created with. A free gift is kept for a limited time; a
 * paid one never expires.
 */
function publishData(gift: Pick<GiftWithCards, 'isPremium'>, now = new Date()) {
  return {
    status: 'PUBLISHED' as const,
    publishedAt: now,
    expiresAt: gift.isPremium ? null : freeGiftExpiry(now),
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
    const gift = await this.withSlugRetry(async () =>
      this.prisma.gift.create({
        data: {
          slug: await this.freeGeneratedSlug(this.prisma),
          editTokenHash: hash,
          locale: request.locale,
          // A draft nobody publishes is deleted, which frees its files and its link.
          expiresAt: draftExpiry(new Date()),
        },
        include: WITH_CARDS,
      }),
    );
    return { gift: this.view(gift), editToken: token };
  }

  async get(giftId: string, access: EditAccess): Promise<GiftEditorView> {
    return this.view(await this.authorize(giftId, access), access);
  }

  async update(
    giftId: string,
    access: EditAccess,
    changes: UpdateGiftRequest,
  ): Promise<GiftEditorView> {
    await this.authorize(giftId, access);
    const { reveal } = changes;
    if (reveal) this.mediaPolicy(giftId).assertReveal(reveal);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Locked so that a concurrent publication sees either the old or the new values.
      const current = await this.lock(tx, giftId);
      this.assertEditable(current, access);
      if (
        current.status === 'PUBLISHED' &&
        changes.recipientName !== undefined &&
        changes.recipientName !== current.recipientName
      ) {
        // The gift was made for this person; a new name would turn it into a gift for someone else.
        throw locked('RECIPIENT_NAME', "The recipient's name cannot change once published");
      }
      if (reveal?.template && planApplies(current)) {
        assertPlanAllows(
          checkRevealTemplate(planOf(current), reveal.template),
          'This reveal is part of the full experience',
        );
      }
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
    return this.view(updated, access);
  }

  async addCard(giftId: string, access: EditAccess, card: CardInput): Promise<GiftEditorView> {
    await this.authorize(giftId, access);
    this.mediaPolicy(giftId).assertCard(card);

    await this.prisma.$transaction(async (tx) => {
      // Locked so that two concurrent requests cannot both pass the card limit.
      const gift = await this.lock(tx, giftId);
      this.assertEditable(gift, access);

      if (planApplies(gift)) {
        assertPlanAllows(
          checkAddCard(planOf(gift), gift.cards.length, card.type),
          'This needs the full experience',
        );
      }
      if (gift.cards.length >= MAX_CARDS_HARD_LIMIT) {
        throw new AppError('CONFLICT', `A gift can have at most ${MAX_CARDS_HARD_LIMIT} cards`);
      }
      const lastPosition = Math.max(-1, ...gift.cards.map((existing) => existing.position));
      await tx.giftCard.create({
        data: { giftId, type: card.type, payload: card.payload, position: lastPosition + 1 },
      });
    });
    return this.view(await this.load(giftId), access);
  }

  async updateCard(
    giftId: string,
    access: EditAccess,
    cardId: string,
    card: CardInput,
  ): Promise<GiftEditorView> {
    await this.authorize(giftId, access);
    this.mediaPolicy(giftId).assertCard(card);
    await this.prisma.$transaction(async (tx) => {
      // Locked, like every other edit: the window closing is decided on one consistent read.
      const gift = await this.lock(tx, giftId);
      this.assertEditable(gift, access);
      const existing = gift.cards.find((candidate) => candidate.id === cardId);
      if (!existing) throw new AppError('NOT_FOUND', 'Card not found');
      if (existing.type !== card.type) {
        throw new AppError('VALIDATION_ERROR', 'The type of a card cannot change');
      }
      await tx.giftCard.update({ where: { id: cardId }, data: { payload: card.payload } });
    });
    return this.view(await this.load(giftId), access);
  }

  async removeCard(giftId: string, access: EditAccess, cardId: string): Promise<GiftEditorView> {
    await this.authorize(giftId, access);
    await this.prisma.$transaction(async (tx) => {
      const gift = await this.lock(tx, giftId);
      this.assertEditable(gift, access);
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
    return this.view(await this.load(giftId), access);
  }

  async reorderCards(
    giftId: string,
    access: EditAccess,
    cardIds: string[],
  ): Promise<GiftEditorView> {
    await this.authorize(giftId, access);
    await this.prisma.$transaction(async (tx) => {
      const gift = await this.lock(tx, giftId);
      this.assertEditable(gift, access);
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
      for (const [position, id] of cardIds.entries()) {
        await tx.giftCard.update({ where: { id }, data: { position } });
      }
    });
    return this.view(await this.load(giftId), access);
  }

  async publish(giftId: string, access: EditAccess): Promise<GiftEditorView> {
    await this.authorize(giftId, access);
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
        const proFeatures = proFeaturesOf({
          cards: gift.cards,
          reveal: { template: gift.revealTemplate },
        });
        if (!gift.isPremium && proFeatures.length > 0) {
          // Editing was free; what the gift ended up using is paid for here, once.
          throw new AppError('PREMIUM_REQUIRED', 'This gift uses the full experience', {
            capability: 'PRO_FEATURES',
            proFeatures,
          });
        }
        return tx.gift.update({
          where: { id: giftId },
          data: publishData(gift),
          include: WITH_CARDS,
        });
      }),
    );
    return this.view(published, access);
  }

  /**
   * Gives the gift the custom link that was paid for but could not be applied, with the name the
   * creator chooses now. The code in front of it is drawn here.
   */
  async changeSlug(giftId: string, access: EditAccess, name: string): Promise<GiftEditorView> {
    const gift = await this.authorize(giftId, access);
    if (!gift.customSlugPending) {
      throw new AppError('PREMIUM_REQUIRED', 'A custom link is a paid extra', {
        capability: 'CUSTOM_SLUG',
      });
    }
    const updated = await this.withSlugRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lock(tx, giftId);
        const slug = await this.freeCustomLink(tx, name);
        await this.keepOldLink(tx, current, slug);
        return tx.gift.update({
          where: { id: giftId },
          data: { slug, slugIsCustom: true, customSlugPending: false },
          include: WITH_CARDS,
        });
      }),
    );
    return this.view(updated, access);
  }

  async remove(giftId: string, access: EditAccess): Promise<void> {
    await this.authorize(giftId, access);
    // Announced first: if another module fails to clean up (stored media), the request fails while
    // the gift still exists, so the creator can simply try again and nothing is left behind.
    await this.events.publish(GiftDeletedEvent, { giftId });
    await this.prisma.gift.deleteMany({ where: { id: giftId } });
  }

  async getPublic(slug: string, now = new Date()): Promise<PublicGift> {
    const gift =
      (await this.prisma.gift.findUnique({ where: { slug }, include: WITH_CARDS })) ??
      // A link the gift had before it got its custom one.
      (await this.prisma.giftSlugAlias
        .findUnique({ where: { slug }, include: { gift: { include: WITH_CARDS } } })
        .then((alias) => alias?.gift ?? null));
    // An expired gift is gone for its recipient even before the daily clean-up removes it.
    const expired = gift?.expiresAt != null && gift.expiresAt <= now;
    if (!gift || gift.status !== 'PUBLISHED' || expired) {
      throw new AppError('NOT_FOUND', 'Gift not found');
    }
    return toPublicGift(gift);
  }

  /**
   * Applies a confirmed payment: premium, no expiry, the buyer's email, a custom link with the name
   * that was bought (`customSlug` is that name), and publication when the gift is ready. Running it again for the same order changes
   * nothing.
   */
  async applyPayment(
    orderId: string,
    giftId: string,
    customSlug: string | null,
    customerEmail: string | null = null,
  ): Promise<void> {
    const applied = await this.withSlugRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const gift = await tx.gift
          .findUnique({ where: { id: giftId }, select: { id: true } })
          .then((found) => (found ? this.lock(tx, giftId) : null));
        if (!gift) return false;
        if (gift.appliedOrderIds.includes(orderId)) return true;

        // The buyer chose the name; the code in front of it is drawn here. A gift whose link
        // already has that name keeps it: a second order must not move the gift.
        const name =
          customSlug !== null && CustomNameSchema.safeParse(customSlug).success ? customSlug : null;
        const hasIt = name !== null && gift.slugIsCustom && parseLink(gift.slug)?.name === name;
        const link = name !== null && !hasIt ? await this.freeCustomLink(tx, name) : null;
        if (link) await this.keepOldLink(tx, gift, link);
        // A name that cannot be used (only possible if the order did not come from the checkout):
        // the upgrade is kept and the creator chooses another name.
        const refusedName = customSlug !== null && name === null;

        await tx.gift.update({
          where: { id: giftId },
          data: {
            isPremium: true,
            appliedOrderIds: { push: orderId },
            // A paid gift is kept for good.
            expiresAt: null,
            ...(customerEmail ? { customerEmail } : {}),
            ...(link
              ? { slug: link, slugIsCustom: true, customSlugPending: false }
              : { customSlugPending: refusedName ? true : gift.customSlugPending }),
            ...(gift.status === 'DRAFT' && missingToPublish(gift).length === 0
              ? publishData({ isPremium: true })
              : {}),
          },
        });
        return true;
      }),
    );
    if (!applied) {
      // The gift was deleted after checkout started: the payments module must give the money back.
      await this.events.publish(PaymentUnappliedEvent, {
        orderId,
        giftId,
        reason: 'GIFT_NOT_FOUND',
      });
    }
  }

  private async authorize(giftId: string, access: EditAccess): Promise<GiftWithCards> {
    const gift = await this.prisma.gift.findUnique({ where: { id: giftId }, include: WITH_CARDS });
    if (!gift) throw new AppError('NOT_FOUND', 'Gift not found');
    const { editToken } = access;
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

  /**
   * A generated link that no existing gift has or used to have. Old links keep opening their gift
   * (aliases), so a new gift must never be given one of them: a QR code printed for someone else
   * would open it. The links of a deleted gift are free again.
   */
  private async freeGeneratedSlug(db: Prisma.TransactionClient | PrismaService): Promise<string> {
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const slug = generateSlug();
      if (await this.slugIsFree(db, slug)) return slug;
    }
    throw new AppError('INTERNAL', 'Could not generate a free link');
  }

  /** A custom link with this name that nobody has: the name stays, the code is drawn until free. */
  private async freeCustomLink(db: Prisma.TransactionClient, name: string): Promise<string> {
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const slug = generateCustomLink(name);
      if (await this.slugIsFree(db, slug)) return slug;
    }
    throw new AppError('INTERNAL', 'Could not generate a free link');
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

  /**
   * Whether this request may change the gift. After publication a gift accepts new editing
   * sessions for a limited time; a session that was open before that time ended goes on, as long
   * as it keeps presenting the grant of its last answer (each answer renews it). A lock by hand
   * ends every session.
   */
  private canEdit(gift: GiftWithCards, access: EditAccess, now = new Date()): boolean {
    if (!isLocked(gift, now)) return true;
    if (isLockedByHand(gift, now) || !access.session) return false;
    try {
      const claims = this.grants.verify(access.session, now);
      return claims.giftId === gift.id && claims.editing;
    } catch {
      return false;
    }
  }

  /** A delivered gift must not be reused for someone else: once locked, nothing changes. */
  private assertEditable(gift: GiftWithCards, access: EditAccess): void {
    if (!this.canEdit(gift, access)) {
      throw locked('GIFT', 'This gift was delivered and can no longer be edited');
    }
  }

  private view(gift: GiftWithCards, access: EditAccess = {}): GiftEditorView {
    const editing = this.canEdit(gift, access);
    const grant = this.grants.issue({
      giftId: gift.id,
      slug: gift.slug,
      plan: planOf(gift),
      published: gift.status === 'PUBLISHED',
      editing,
    });
    return toEditorView(gift, this.env.WEB_ORIGIN, grant, !editing);
  }
}
