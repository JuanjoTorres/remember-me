import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiErrorSchema,
  CreateGiftResponseSchema,
  DRAFT_TTL_DAYS,
  EDIT_GRACE_HOURS,
  customLink,
  freeGiftExpiry,
  GIFT_CODE_LENGTH,
  type GiftEditorView,
  GiftEditorViewSchema,
  GiftLinkSchema,
  GiftLockedDetailsSchema,
  MAX_CARDS_HARD_LIMIT,
  PLAN_CAPABILITIES,
  PremiumRequiredDetailsSchema,
  PublicGiftSchema,
  SlugAvailabilitySchema,
} from '@remember-me/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GRANT_TTL_SECONDS } from '../src/shared/auth/gift-grant.service.js';
import { GiftDeletedEvent, PaymentSucceededEvent } from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, freeCustomLink, makePremium, mediaUrl, photoCard } from './helpers.js';

describe('gifts', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function publishedGift(recipientName = 'Sarah') {
    const { gift, editToken } = await createGift(app);
    const client = editor(app, gift.id, editToken);
    await client.addCard(photoCard()).expect(201);
    await client
      .update({ recipientName, reveal: { headline: 'We are going to Lisbon' } })
      .expect(200);
    const published = (await client.publish().expect(200)).body as GiftEditorView;
    return { client, gift: published, editToken };
  }

  describe('creation and edit access', () => {
    it('creates a free draft and returns the edit token once', async () => {
      const response = await http().post('/gifts').send({}).expect(201);
      const { gift, editToken } = CreateGiftResponseSchema.parse(response.body);
      expect(gift).toMatchObject({ status: 'DRAFT', plan: 'FREE', locale: 'en', cards: [] });
      expect(gift.capabilities.maxCards).toBe(3);
      expect(editToken.length).toBeGreaterThanOrEqual(40);

      const stored = await app
        .get(PrismaService)
        .gift.findUniqueOrThrow({ where: { id: gift.id } });
      expect(stored.editTokenHash).not.toContain(editToken);

      const again = await editor(app, gift.id, editToken).get().expect(200);
      expect(JSON.stringify(again.body)).not.toContain(editToken);
      GiftEditorViewSchema.parse(again.body);
    });

    it('rejects a missing or wrong token on every editor endpoint', async () => {
      const { gift } = await createGift(app);
      for (const token of [undefined, 'wrong-token']) {
        const client = editor(app, gift.id, token ?? '');
        const calls = [
          client.get(),
          client.update({ recipientName: 'x' }),
          client.addCard(photoCard()),
          client.publish(),
          client.changeSlug('7k2m/for/some-slug'),
          client.reorder([gift.id]),
          client.updateCard(gift.id, photoCard()),
          client.removeCard(gift.id),
          client.remove(),
        ];
        for (const call of calls) {
          const response = await call;
          expect(response.status).toBe(401);
          expect(ApiErrorSchema.parse(response.body).code).toBe('UNAUTHORIZED');
        }
      }
    });

    it('answers 404 for an unknown gift and 400 for a malformed id', async () => {
      await http()
        .get('/gifts/3f0e6f0a-58a1-4d53-a4a9-3c2a0f6d2b11')
        .set('x-edit-token', 'x')
        .expect(404);
      await http().get('/gifts/not-a-uuid').set('x-edit-token', 'x').expect(400);
    });
  });

  const audioCard = (giftId: string) => ({
    type: 'AUDIO_NOTE',
    payload: { audioUrl: mediaUrl(giftId, 'voice.m4a') },
  });
  const triviaCard = {
    type: 'TRIVIA',
    payload: { question: 'Where?', options: ['A', 'B'], correctIndex: 0 },
  };
  const FREE_CARDS = PLAN_CAPABILITIES.FREE.maxCards ?? 0;

  /** Moves the publication of a gift into the past, as if that much time had gone by. */
  const payFor = (giftId: string, customSlug: string | null, orderId = `order-${randomUUID()}`) =>
    app.get(EventBus).publish(PaymentSucceededEvent, { orderId, giftId, customSlug });

  /** A custom link that a published gift already has. */
  async function takenCustomLink(): Promise<string> {
    const { gift } = await publishedGift();
    const link = freeCustomLink('ocupado');
    await payFor(gift.id, link);
    return link;
  }

  const publishedHoursAgo = (giftId: string, hours: number) =>
    app.get(PrismaService).gift.update({
      where: { id: giftId },
      data: { publishedAt: new Date(Date.now() - hours * 3_600_000) },
    });

  describe('a draft is not limited by the plan', () => {
    it('takes any number of cards, voice notes, trivia and every reveal', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      for (let i = 0; i <= FREE_CARDS; i += 1)
        await client.addCard(photoCard(`card ${i}`)).expect(201);
      await client.addCard(audioCard(gift.id)).expect(201);
      await client.addCard(triviaCard).expect(201);
      for (const template of ['SCRATCH_CARD', 'TICKET', 'GIFT_BOX']) {
        await client.update({ reveal: { template } }).expect(200);
      }

      const view = GiftEditorViewSchema.parse((await client.get().expect(200)).body);
      expect(view).toMatchObject({ plan: 'FREE', status: 'DRAFT' });
      expect(view.cards).toHaveLength(FREE_CARDS + 3);
      expect(view.proFeatures).toEqual(['EXTRA_CARDS', 'VOICE_NOTE', 'TRIVIA', 'PREMIUM_REVEAL']);
    });

    it('reports no paid feature for a gift the free plan allows', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      for (let i = 0; i < FREE_CARDS; i += 1)
        await client.addCard(photoCard(`card ${i}`)).expect(201);
      expect(((await client.get()).body as GiftEditorView).proFeatures).toEqual([]);
    });

    it('still stops at the technical ceiling of cards', async () => {
      const { gift, editToken } = await createGift(app);
      await app.get(PrismaService).giftCard.createMany({
        data: Array.from({ length: MAX_CARDS_HARD_LIMIT }, (_, position) => ({
          giftId: gift.id,
          position,
          type: 'PHOTO_TEXT' as const,
          payload: { text: 'x', imageUrl: null },
        })),
      });
      const response = await editor(app, gift.id, editToken).addCard(photoCard()).expect(409);
      expect(response.body.code).toBe('CONFLICT');
    });
  });

  describe('the paywall is at publication', () => {
    async function readyDraft() {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      await client.addCard(photoCard()).expect(201);
      await client.update({ recipientName: 'Ana', reveal: { headline: 'Surprise' } }).expect(200);
      return { gift, client };
    }

    it('publishes for free a gift that uses no paid feature', async () => {
      const { client } = await readyDraft();
      const view = (await client.publish().expect(200)).body as GiftEditorView;
      expect(view).toMatchObject({ status: 'PUBLISHED', plan: 'FREE', proFeatures: [] });
      expect((await http().get(`/public/gifts/${view.slug}`).expect(200)).body.watermark).toBe(
        true,
      );
    });

    it.each([
      ['one card over the free limit', 'EXTRA_CARDS'],
      ['a voice note', 'VOICE_NOTE'],
      ['a trivia', 'TRIVIA'],
      ['a premium reveal', 'PREMIUM_REVEAL'],
    ] as const)('asks for payment when the gift has %s', async (_what, feature) => {
      const { gift, client } = await readyDraft();
      if (feature === 'EXTRA_CARDS') {
        for (let i = 1; i <= FREE_CARDS; i += 1)
          await client.addCard(photoCard(`card ${i}`)).expect(201);
      }
      if (feature === 'VOICE_NOTE') await client.addCard(audioCard(gift.id)).expect(201);
      if (feature === 'TRIVIA') await client.addCard(triviaCard).expect(201);
      if (feature === 'PREMIUM_REVEAL') {
        await client.update({ reveal: { template: 'TICKET' } }).expect(200);
      }

      const response = await client.publish().expect(402);
      expect(ApiErrorSchema.parse(response.body)).toMatchObject({
        code: 'PREMIUM_REQUIRED',
        details: { capability: 'PRO_FEATURES', proFeatures: [feature] },
      });
      PremiumRequiredDetailsSchema.parse(response.body.details);
      // Nothing was published and nothing was taken away.
      expect((await client.get()).body).toMatchObject({ status: 'DRAFT', plan: 'FREE' });
      await http().get(`/public/gifts/${gift.slug}`).expect(404);
    });

    it('says what is missing before it asks for payment', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      await client.addCard(triviaCard).expect(201);
      const response = await client.publish().expect(422);
      expect(response.body.details).toEqual({ missing: ['REVEAL_HEADLINE'] });
    });

    it('publishes the gift, without watermark, once it is paid for', async () => {
      const { gift, client } = await readyDraft();
      await client.addCard(triviaCard).expect(201);
      await client.publish().expect(402);

      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: gift.id,
        customSlug: null,
      });
      const view = (await client.get().expect(200)).body as GiftEditorView;
      expect(view).toMatchObject({ status: 'PUBLISHED', plan: 'PREMIUM', expiresAt: null });
      expect((await http().get(`/public/gifts/${view.slug}`).expect(200)).body.watermark).toBe(
        false,
      );
      // Publishing again is the harmless double tap it always was.
      expect((await client.publish().expect(200)).body.slug).toBe(view.slug);
    });

    it('lets a paid draft with paid features be published directly', async () => {
      const { gift, client } = await readyDraft();
      await makePremium(app, gift.id);
      await client.addCard(triviaCard).expect(201);
      expect((await client.publish().expect(200)).body).toMatchObject({
        status: 'PUBLISHED',
        plan: 'PREMIUM',
        expiresAt: null,
      });
    });
  });

  describe('plan limits of a published gift', () => {
    it('keeps a free gift at the free number of cards', async () => {
      const { client } = await publishedGift();
      for (let i = 1; i < FREE_CARDS; i += 1)
        await client.addCard(photoCard(`card ${i}`)).expect(201);

      const response = await client.addCard(photoCard('one too many')).expect(402);
      expect(ApiErrorSchema.parse(response.body)).toMatchObject({
        code: 'PREMIUM_REQUIRED',
        details: { capability: 'MAX_CARDS' },
      });
      expect(((await client.get()).body as GiftEditorView).cards).toHaveLength(FREE_CARDS);
    });

    it('does not let concurrent requests slip past the card limit', async () => {
      const { client } = await publishedGift();
      const statuses = (
        await Promise.all(
          Array.from({ length: 6 }, (_, i) => client.addCard(photoCard(`card ${i}`))),
        )
      ).map((response) => response.status);
      // The gift was published with one card.
      expect(statuses.filter((status) => status === 201)).toHaveLength(FREE_CARDS - 1);
      expect(statuses.filter((status) => status === 402)).toHaveLength(6 - (FREE_CARDS - 1));
    });

    it('blocks voice notes and trivia on a free gift', async () => {
      const { gift, client } = await publishedGift();
      for (const card of [audioCard(gift.id), triviaCard]) {
        const response = await client.addCard(card).expect(402);
        expect(response.body).toMatchObject({
          code: 'PREMIUM_REQUIRED',
          details: { capability: 'CARD_TYPE' },
        });
      }
    });

    it('blocks premium reveal templates on a free gift', async () => {
      const { client } = await publishedGift();
      for (const template of ['SCRATCH_CARD', 'TICKET', 'GIFT_BOX']) {
        const response = await client.update({ reveal: { template } }).expect(402);
        expect(response.body).toMatchObject({
          code: 'PREMIUM_REQUIRED',
          details: { capability: 'REVEAL_TEMPLATE' },
        });
      }
      await client.update({ reveal: { template: 'BASIC' } }).expect(200);
    });

    it('lifts every limit once the gift is premium', async () => {
      const { gift, editToken } = await createGift(app);
      await makePremium(app, gift.id);
      const client = editor(app, gift.id, editToken);
      for (let i = 0; i < 5; i += 1) await client.addCard(photoCard(`card ${i}`)).expect(201);
      await client
        .addCard({
          type: 'AUDIO_NOTE',
          payload: { audioUrl: mediaUrl(gift.id, 'voice.mp3'), caption: 'Listen' },
        })
        .expect(201);
      await client
        .addCard({
          type: 'TRIVIA',
          payload: { question: 'Where?', options: ['A', 'B'], correctIndex: 1 },
        })
        .expect(201);
      const view = (await client.update({ reveal: { template: 'SCRATCH_CARD' } }).expect(200))
        .body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', reveal: { template: 'SCRATCH_CARD' } });
      expect(view.cards).toHaveLength(7);
      expect(view.capabilities.watermark).toBe(false);
    });
  });

  describe('cards', () => {
    it('validates the payload against the card type', async () => {
      const { gift, editToken } = await createGift(app);
      const response = await editor(app, gift.id, editToken)
        .addCard({ type: 'PHOTO_TEXT', payload: {} })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('only accepts media that was uploaded for the same gift', async () => {
      const { gift, editToken } = await createGift(app);
      const other = await createGift(app);
      const client = editor(app, gift.id, editToken);
      const card = (imageUrl: string) => ({ type: 'PHOTO_TEXT', payload: { imageUrl, text: '' } });

      await client.addCard(card(mediaUrl(gift.id, 'photo.webp'))).expect(201);
      await client.addCard(card(mediaUrl(other.gift.id, 'photo.webp'))).expect(400);
      await client.addCard(card('https://evil.example/tracker.webp')).expect(400);
      await client.addCard(card(mediaUrl(gift.id, 'photo.exe'))).expect(400);
      await client.addCard(card(mediaUrl(gift.id, '../other/photo.webp'))).expect(400);
      await client.update({ reveal: { imageUrl: 'https://evil.example/x.webp' } }).expect(400);
    });

    it('updates, reorders and removes cards', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      await client.addCard(photoCard('a'));
      await client.addCard(photoCard('b'));
      const { cards } = (await client.addCard(photoCard('c'))).body as GiftEditorView;
      const [a, b, c] = cards.map((card) => card.id) as [string, string, string];

      const reordered = (await client.reorder([c, a, b]).expect(200)).body as GiftEditorView;
      expect(reordered.cards.map((card) => card.id)).toEqual([c, a, b]);
      expect(reordered.cards.map((card) => card.position)).toEqual([0, 1, 2]);
      await client.reorder([c, a]).expect(400);
      await client.reorder([c, a, a]).expect(400);

      const updated = (await client.updateCard(a, photoCard('a, edited')).expect(200))
        .body as GiftEditorView;
      expect(updated.cards[1]?.payload).toMatchObject({ text: 'a, edited' });
      await client
        .updateCard(a, {
          type: 'TRIVIA',
          payload: { question: 'q', options: ['x', 'y'], correctIndex: 0 },
        })
        .expect(400);

      const afterRemoval = (await client.removeCard(c).expect(200)).body as GiftEditorView;
      expect(afterRemoval.cards.map((card) => card.id)).toEqual([a, b]);
      await client.removeCard(c).expect(404);
      // A slot is free again, so a free gift can add a third card.
      await client.addCard(photoCard('d')).expect(201);
      await client.update({ recipientName: 'nul\u0000byte' }).expect(400);
    });

    it('cannot touch a card of another gift', async () => {
      const mine = await createGift(app);
      const theirs = await createGift(app);
      const theirCard = (
        (await editor(app, theirs.gift.id, theirs.editToken).addCard(photoCard()))
          .body as GiftEditorView
      ).cards[0]!.id;
      const client = editor(app, mine.gift.id, mine.editToken);
      await client.updateCard(theirCard, photoCard('hijacked')).expect(404);
      await client.removeCard(theirCard).expect(404);
    });
  });

  describe('publishing', () => {
    it('refuses to publish an incomplete gift and says what is missing', async () => {
      const { gift, editToken } = await createGift(app);
      const response = await editor(app, gift.id, editToken).publish().expect(422);
      expect(response.body).toMatchObject({
        code: 'GIFT_INCOMPLETE',
        details: { missing: ['CARDS', 'REVEAL_HEADLINE'] },
      });
    });

    it('publishes a free gift under the code it was created with, which says nothing about it', async () => {
      const { gift, client } = await publishedGift('Sarah Öz');
      expect(gift.status).toBe('PUBLISHED');
      expect(gift.slug).toMatch(/^[a-z0-9]{8}$/);
      expect(gift.slug).toMatch(/[0-9]/);
      expect(gift.slug).not.toContain('sarah');
      expect(gift.publicUrl).toBe(`http://localhost:3000/${gift.slug}`);
      // Publishing again keeps the link stable.
      expect(((await client.publish().expect(200)).body as GiftEditorView).slug).toBe(gift.slug);
    });

    it('serves a published gift to the recipient without anything secret', async () => {
      const { gift, editToken } = await publishedGift();
      const response = await http().get(`/public/gifts/${gift.slug}`).expect(200);
      const publicGift = PublicGiftSchema.parse(response.body);
      expect(publicGift).toMatchObject({ recipientName: 'Sarah', watermark: true, locale: 'es' });
      expect(publicGift.reveal.headline).toBe('We are going to Lisbon');
      const raw = JSON.stringify(response.body);
      for (const secret of [editToken, gift.grant, gift.id, 'editTokenHash'])
        expect(raw).not.toContain(secret);
    });

    it('drops the watermark for a premium gift', async () => {
      const { gift } = await publishedGift();
      await makePremium(app, gift.id);
      expect((await http().get(`/public/gifts/${gift.slug}`).expect(200)).body.watermark).toBe(
        false,
      );
    });

    it('never serves a draft or an unknown slug', async () => {
      const { gift } = await createGift(app);
      await http().get(`/public/gifts/${gift.slug}`).expect(404);
      await http().get('/public/gifts/does-not-exist').expect(404);
      await http().get('/public/gifts/x9k2bd7m').expect(404);
      await http().get('/public/gifts/7k2m/for/nobody-here').expect(404);
    });
  });

  describe('a published gift stays complete', () => {
    it('keeps its last card and its headline', async () => {
      const { gift, client } = await publishedGift();
      const response = await client.removeCard(gift.cards[0]!.id).expect(422);
      expect(response.body).toMatchObject({
        code: 'GIFT_INCOMPLETE',
        details: { missing: ['CARDS'] },
      });
      await client.update({ reveal: { headline: '  ' } }).expect(422);
      await client.update({ reveal: { headline: 'Porto instead' } }).expect(200);

      await client.addCard(photoCard('second')).expect(201);
      await client.removeCard(gift.cards[0]!.id).expect(200);
    });

    it('gets one link even when publish is tapped twice', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      await client.addCard(photoCard()).expect(201);
      await client.update({ recipientName: 'Ana', reveal: { headline: 'Surprise' } }).expect(200);

      const responses = await Promise.all([client.publish(), client.publish(), client.publish()]);
      const slugs = new Set(responses.map((response) => (response.body as GiftEditorView).slug));
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(slugs.size).toBe(1);
      await http()
        .get(`/public/gifts/${[...slugs][0]}`)
        .expect(200);
    });
  });

  describe('payment events', () => {
    const pay = payFor;

    it('upgrades and publishes a ready draft', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      await client.addCard(photoCard()).expect(201);
      await client.update({ recipientName: 'Ana', reveal: { headline: 'Surprise' } }).expect(200);

      await pay(gift.id, null);
      const view = (await client.get().expect(200)).body as GiftEditorView;
      expect(view).toMatchObject({
        plan: 'PREMIUM',
        status: 'PUBLISHED',
        customSlugPending: false,
      });
      // The link is the one the draft already had.
      expect(view.slug).toBe(gift.slug);
      expect(view.capabilities.maxCards).toBeNull();
    });

    it('upgrades an unfinished draft without publishing it', async () => {
      const { gift, editToken } = await createGift(app);
      await pay(gift.id, null);
      const view = (await editor(app, gift.id, editToken).get()).body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', status: 'DRAFT' });
    });

    it('applies the custom link, and keeps it when the gift is published later', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      const slug = freeCustomLink();
      await pay(gift.id, slug);
      expect(((await client.get()).body as GiftEditorView).slug).toBe(slug);

      await client.addCard(photoCard()).expect(201);
      await client.update({ recipientName: 'Ana', reveal: { headline: 'Surprise' } }).expect(200);
      expect(((await client.publish().expect(200)).body as GiftEditorView).slug).toBe(slug);
      await http().get(`/public/gifts/${slug}`).expect(200);
    });

    it('still upgrades when the custom link was taken, and lets the creator pick another once', async () => {
      const taken = await takenCustomLink();
      const { gift, client } = await publishedGift();
      const orderId = `order-${randomUUID()}`;

      await pay(gift.id, taken, orderId);
      const view = (await client.get()).body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', slug: gift.slug, customSlugPending: true });

      const chosen = freeCustomLink('second-choice');
      await client.changeSlug(chosen).expect(200);

      // The same payment delivered again must not reopen the choice or move the gift.
      await pay(gift.id, taken, orderId);
      expect((await client.get()).body).toMatchObject({ slug: chosen, customSlugPending: false });
      await client.changeSlug(freeCustomLink('third-choice')).expect(402);
    });

    it('keeps the email of the buyer, and does not lose it when the event comes without one', async () => {
      const { gift } = await publishedGift();
      const stored = () =>
        app.get(PrismaService).gift.findUniqueOrThrow({ where: { id: gift.id } });
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: gift.id,
        customSlug: null,
        customerEmail: 'buyer@example.com',
      });
      expect(await stored()).toMatchObject({ customerEmail: 'buyer@example.com', expiresAt: null });

      // An event stored before the field existed carries no email at all.
      await pay(gift.id, null);
      expect((await stored()).customerEmail).toBe('buyer@example.com');
    });

    it('ignores an old order that is delivered again after a newer one', async () => {
      const { gift, client } = await publishedGift();
      const [first, second] = [freeCustomLink('first'), freeCustomLink('second')];
      await pay(gift.id, first, 'order-a-' + gift.id);
      await pay(gift.id, second, 'order-b-' + gift.id);
      await pay(gift.id, first, 'order-a-' + gift.id);
      expect((await client.get()).body).toMatchObject({ slug: second, customSlugPending: false });
      // Every link the published gift ever had still opens it.
      for (const slug of [gift.slug, first, second])
        await http().get(`/public/gifts/${slug}`).expect(200);
    });

    it('is idempotent for a repeated order and ignores a deleted gift', async () => {
      const { gift, client } = await publishedGift();
      const orderId = `order-${randomUUID()}`;
      const slug = freeCustomLink('mi-regalo');
      await pay(gift.id, slug, orderId);
      await pay(gift.id, slug, orderId);
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM', slug });

      await client.remove().expect(204);
      await expect(pay(gift.id, null)).resolves.toBeUndefined();
    });

    it.each(['create', '7k2m/for/create', 'luis/for/ana', 'ana-luis-x9k2'])(
      'rejects the invalid custom link %s but keeps the upgrade',
      async (invalid) => {
        const { gift, client } = await publishedGift();
        await pay(gift.id, invalid);
        expect((await client.get()).body).toMatchObject({
          plan: 'PREMIUM',
          slug: gift.slug,
          customSlugPending: true,
        });
      },
    );
  });

  describe('slugs', () => {
    const check = async (slug: string) =>
      SlugAvailabilitySchema.parse(
        (await http().get('/gifts/check-slug').query({ slug }).expect(200)).body,
      );

    it('reports availability', async () => {
      const free = freeCustomLink('te-quiero-ana');
      expect(await check(free)).toEqual({ slug: free, available: true });
      expect(await check('7k2m/for/create')).toMatchObject({
        available: false,
        reason: 'RESERVED',
      });
      expect(await check('Not Valid')).toMatchObject({ available: false, reason: 'INVALID' });
      const taken = await takenCustomLink();
      expect(await check(taken)).toEqual({ slug: taken, available: false, reason: 'TAKEN' });
    });

    it('refuses a link that is not a code followed by a name', async () => {
      for (const slug of [
        'laura',
        'te-quiero-ana-x9k2',
        'x9k2bd7m',
        'luis/for/ana',
        '7k2/for/ana-luis',
        '7k2m/for/an',
      ]) {
        expect(await check(slug)).toEqual({ slug, available: false, reason: 'INVALID' });
      }
    });

    it('lets the same name be taken again behind another code', async () => {
      const taken = await takenCustomLink();
      const name = taken.split('/for/')[1]!;
      const other = customLink(taken.startsWith('7k2m') ? '8k2m' : '7k2m', name);
      expect(await check(other)).toEqual({ slug: other, available: true });
    });

    it('gives every gift a random code from the start, also a draft', async () => {
      const { gift } = await createGift(app);
      expect(GiftLinkSchema.safeParse(gift.slug).success).toBe(true);
      expect(gift.slug).toHaveLength(GIFT_CODE_LENGTH);
    });

    it('only lets a gift change its link when a paid custom link is pending', async () => {
      const { gift, client } = await publishedGift();
      const refused = await client.changeSlug(freeCustomLink('my-own-link')).expect(402);
      expect(refused.body.details).toEqual({ capability: 'CUSTOM_SLUG' });

      const taken = await takenCustomLink();
      await app
        .get(PrismaService)
        .gift.update({ where: { id: gift.id }, data: { customSlugPending: true } });
      expect((await client.changeSlug(taken).expect(409)).body.code).toBe('SLUG_TAKEN');
      await client.changeSlug('7k2m/for/create').expect(400);
      // A custom link needs its code in front, and a code is never a word.
      await client.changeSlug('my-own').expect(400);
      await client.changeSlug('luis/for/my-own').expect(400);

      const chosen = freeCustomLink('my-own-link');
      const changed = (await client.changeSlug(chosen).expect(200)).body as GiftEditorView;
      expect(changed).toMatchObject({ slug: chosen, customSlugPending: false });
      await http().get(`/public/gifts/${chosen}`).expect(200);
      await client.changeSlug(freeCustomLink('another-link')).expect(402);
      // The link it was published with still works and stays reserved.
      expect((await http().get(`/public/gifts/${gift.slug}`).expect(200)).body.slug).toBe(chosen);
    });
  });

  describe('a delivered gift cannot be reused', () => {
    const expectLocked = async (call: PromiseLike<request.Response>, scope: string) => {
      const response = await call;
      expect(response.status).toBe(423);
      expect(ApiErrorSchema.parse(response.body).code).toBe('GIFT_LOCKED');
      expect(GiftLockedDetailsSchema.parse(response.body.details)).toEqual({ scope });
    };

    it("fixes the recipient's name as soon as the gift is published", async () => {
      const { client } = await publishedGift('Sarah');
      await expectLocked(client.update({ recipientName: 'Laura' }), 'RECIPIENT_NAME');
      // Nothing else in the same request is saved either.
      await expectLocked(
        client.update({ recipientName: 'Laura', senderName: 'Tom' }),
        'RECIPIENT_NAME',
      );
      expect((await client.get()).body).toMatchObject({ recipientName: 'Sarah', senderName: '' });

      // Sending the same name again (the editor saves whole forms) is not a change.
      await client.update({ recipientName: 'Sarah', senderName: 'Tom' }).expect(200);
    });

    it('lets a draft change the name freely', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      await client.update({ recipientName: 'Sarah' }).expect(200);
      await client.update({ recipientName: 'Laura' }).expect(200);
    });

    it('allows corrections during the grace period and says when it ends', async () => {
      const { gift, client } = await publishedGift();
      await publishedHoursAgo(gift.id, EDIT_GRACE_HOURS - 1);

      const view = GiftEditorViewSchema.parse((await client.get().expect(200)).body);
      expect(view.locked).toBe(false);
      expect(new Date(view.editableUntil!).getTime()).toBe(
        new Date(view.publishedAt!).getTime() + EDIT_GRACE_HOURS * 3_600_000,
      );
      await client.update({ reveal: { headline: 'Porto, not Lisbon' } }).expect(200);
      await client.updateCard(gift.cards[0]!.id, photoCard('typo fixed')).expect(200);
      await client.addCard(photoCard('one more')).expect(201);
    });

    it('refuses every edit once the grace period is over', async () => {
      const { gift, client } = await publishedGift();
      const second = (
        (await client.addCard(photoCard('second')).expect(201)).body as GiftEditorView
      ).cards[1]!.id;
      const first = gift.cards[0]!.id;
      await publishedHoursAgo(gift.id, EDIT_GRACE_HOURS + 1);

      for (const call of [
        client.update({ senderName: 'Tom' }),
        client.update({ reveal: { headline: 'Something else' } }),
        client.addCard(photoCard('late')),
        client.updateCard(first, photoCard('late edit')),
        client.removeCard(second),
        client.reorder([second, first]),
      ]) {
        await expectLocked(call, 'GIFT');
      }

      const view = (await client.get().expect(200)).body as GiftEditorView;
      expect(view).toMatchObject({ locked: true, senderName: '' });
      expect(view.cards.map((card) => card.id)).toEqual([first, second]);
      // The recipient is not affected.
      await http().get(`/public/gifts/${gift.slug}`).expect(200);
    });

    it('lets an editor opened before the end go on saving after it', async () => {
      const { gift, editToken } = await publishedGift();
      await publishedHoursAgo(gift.id, EDIT_GRACE_HOURS - 1);
      // The browser keeps the grant of the last answer and sends it with the next request.
      let grant = '';
      const open = editor(app, gift.id, editToken, () => grant);
      const keep = (response: { body: GiftEditorView }) => {
        grant = response.body.grant;
        return response.body;
      };
      keep(await editor(app, gift.id, editToken).get().expect(200));

      await publishedHoursAgo(gift.id, EDIT_GRACE_HOURS + 1);
      expect(keep(await open.update({ senderName: 'Tom' }).expect(200)).locked).toBe(false);
      const cards = keep(await open.addCard(photoCard('late, but mine')).expect(201)).cards;
      const [first, second] = [cards[0]!.id, cards[1]!.id];
      keep(await open.updateCard(first, photoCard('typo fixed late')).expect(200));
      keep(await open.reorder([second, first]).expect(200));
      keep(await open.removeCard(first).expect(200));
      // Reloading the page keeps the session too.
      expect(keep(await open.get().expect(200))).toMatchObject({
        locked: false,
        senderName: 'Tom',
      });
      keep(await open.update({ reveal: { headline: 'Porto' } }).expect(200));

      // Opening the edit link now starts no session: the gift is locked for that visit.
      const late = editor(app, gift.id, editToken);
      const view = (await late.get().expect(200)).body as GiftEditorView;
      expect(view.locked).toBe(true);
      await expectLocked(late.update({ senderName: 'Someone else' }), 'GIFT');
      // And the grant of a locked visit does not open one either.
      await expectLocked(
        editor(app, gift.id, editToken, () => view.grant).update({ senderName: 'Someone else' }),
        'GIFT',
      );
    });

    it('ends an editing session whose grant has run out, or that belongs to another gift', async () => {
      const { gift, editToken } = await publishedGift();
      const other = await publishedGift();
      const grant = ((await editor(app, gift.id, editToken).get()).body as GiftEditorView).grant;
      const otherGrant = ((await other.client.get()).body as GiftEditorView).grant;
      await publishedHoursAgo(gift.id, EDIT_GRACE_HOURS + 1);

      await expectLocked(
        editor(app, gift.id, editToken, () => otherGrant).update({ senderName: 'Tom' }),
        'GIFT',
      );
      await expectLocked(
        editor(app, gift.id, editToken, () => 'not-a-grant').update({ senderName: 'Tom' }),
        'GIFT',
      );
      // Half an hour without a request: the grant, and with it the session, is over.
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + (GRANT_TTL_SECONDS + 1) * 1000 });
      try {
        await expectLocked(
          editor(app, gift.id, editToken, () => grant).update({ senderName: 'Tom' }),
          'GIFT',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('ends every editing session when the gift is locked by hand', async () => {
      const { gift, editToken } = await publishedGift();
      const grant = ((await editor(app, gift.id, editToken).get()).body as GiftEditorView).grant;
      await app
        .get(PrismaService)
        .gift.update({ where: { id: gift.id }, data: { lockedAt: new Date(Date.now() - 1000) } });
      const open = editor(app, gift.id, editToken, () => grant);
      await expectLocked(open.update({ senderName: 'Tom' }), 'GIFT');
      expect((await open.get()).body.locked).toBe(true);
    });

    it('locks at once when the gift is locked by hand', async () => {
      const { gift, client } = await publishedGift();
      await app
        .get(PrismaService)
        .gift.update({ where: { id: gift.id }, data: { lockedAt: new Date(Date.now() - 1000) } });
      await expectLocked(client.update({ senderName: 'Tom' }), 'GIFT');
      expect((await client.get()).body.locked).toBe(true);
    });

    it('can still be paid for and deleted when locked', async () => {
      const { gift, client } = await publishedGift();
      await publishedHoursAgo(gift.id, EDIT_GRACE_HOURS + 1);
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: gift.id,
        customSlug: null,
      });
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM', locked: true });
      await client.remove().expect(204);
      await client.get().expect(404);
    });
  });

  describe('expiry', () => {
    const DAY_MS = 24 * 3_600_000;
    const near = (iso: string | null, expected: number) => {
      expect(iso).not.toBeNull();
      expect(Math.abs(new Date(iso!).getTime() - expected)).toBeLessThan(60_000);
    };

    it('gives a draft a week', async () => {
      const { gift } = await createGift(app);
      near(gift.expiresAt, Date.now() + DRAFT_TTL_DAYS * DAY_MS);
    });

    it('gives a free gift three months from its publication', async () => {
      const { gift } = await publishedGift();
      expect(gift.expiresAt).toBe(freeGiftExpiry(new Date(gift.publishedAt!)).toISOString());
      const days = (Date.parse(gift.expiresAt!) - Date.parse(gift.publishedAt!)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(89);
      expect(days).toBeLessThanOrEqual(92);
    });

    it('never expires a paid gift, draft or published', async () => {
      const draft = await createGift(app);
      const published = await publishedGift();
      for (const giftId of [draft.gift.id, published.gift.id]) {
        await app.get(EventBus).publish(PaymentSucceededEvent, {
          orderId: `order-${randomUUID()}`,
          giftId,
          customSlug: null,
        });
      }
      expect((await editor(app, draft.gift.id, draft.editToken).get()).body.expiresAt).toBeNull();
      expect((await published.client.get()).body.expiresAt).toBeNull();
    });

    it('stops serving an expired gift even before it is cleaned up', async () => {
      const { gift } = await publishedGift();
      await app
        .get(PrismaService)
        .gift.update({ where: { id: gift.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().get(`/public/gifts/${gift.slug}`).expect(404);
    });
  });

  describe('deletion', () => {
    it('deletes the gift with its cards and announces it', async () => {
      const { gift, client } = await publishedGift();
      const deleted: string[] = [];
      app
        .get(EventBus)
        .subscribe(GiftDeletedEvent, 'test', async ({ giftId }) => void deleted.push(giftId));

      await client.remove().expect(204);
      expect(deleted).toEqual([gift.id]);
      await client.get().expect(404);
      await http().get(`/public/gifts/${gift.slug}`).expect(404);
      expect(await app.get(PrismaService).giftCard.count({ where: { giftId: gift.id } })).toBe(0);
    });
  });
});
