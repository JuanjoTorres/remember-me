import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiErrorSchema,
  CreateGiftResponseSchema,
  type GiftEditorView,
  GiftEditorViewSchema,
  PublicGiftSchema,
} from '@remember-me/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GiftDeletedEvent, PaymentSucceededEvent } from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, makePremium, mediaUrl, photoCard } from './helpers.js';

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
          client.changeSlug('some-slug'),
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

  describe('plan limits', () => {
    it('lets a free gift have three photo cards and asks for premium on the fourth', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      for (const text of ['one', 'two', 'three']) await client.addCard(photoCard(text)).expect(201);

      const response = await client.addCard(photoCard('four')).expect(402);
      expect(ApiErrorSchema.parse(response.body)).toMatchObject({
        code: 'PREMIUM_REQUIRED',
        details: { capability: 'MAX_CARDS' },
      });
      expect(((await client.get()).body as GiftEditorView).cards).toHaveLength(3);
    });

    it('does not let concurrent requests slip past the card limit', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      const statuses = (
        await Promise.all(
          Array.from({ length: 6 }, (_, i) => client.addCard(photoCard(`card ${i}`))),
        )
      ).map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(3);
      expect(statuses.filter((status) => status === 402)).toHaveLength(3);
    });

    it('blocks voice notes and trivia on a free gift', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
      const audio = { type: 'AUDIO_NOTE', payload: { audioUrl: mediaUrl(gift.id, 'voice.m4a') } };
      const trivia = {
        type: 'TRIVIA',
        payload: { question: 'Where?', options: ['A', 'B'], correctIndex: 0 },
      };
      for (const card of [audio, trivia]) {
        const response = await client.addCard(card).expect(402);
        expect(response.body).toMatchObject({
          code: 'PREMIUM_REQUIRED',
          details: { capability: 'CARD_TYPE' },
        });
      }
    });

    it('blocks premium reveal templates on a free gift', async () => {
      const { gift, editToken } = await createGift(app);
      const client = editor(app, gift.id, editToken);
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

    it('publishes a free gift with a link named after the recipient', async () => {
      const { gift, client } = await publishedGift('Sarah Öz');
      expect(gift.status).toBe('PUBLISHED');
      expect(gift.slug).toMatch(/^sarah-oz-[a-z0-9]{6}$/);
      expect(gift.publicUrl).toBe(`http://localhost:3000/for/${gift.slug}`);
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
    const pay = (giftId: string, customSlug: string | null, orderId = `order-${randomUUID()}`) =>
      app.get(EventBus).publish(PaymentSucceededEvent, { orderId, giftId, customSlug });

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
      expect(view.slug).toMatch(/^ana-/);
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
      const slug = `te-quiero-${randomUUID().slice(0, 8)}`;
      await pay(gift.id, slug);
      expect(((await client.get()).body as GiftEditorView).slug).toBe(slug);

      await client.addCard(photoCard()).expect(201);
      await client.update({ recipientName: 'Ana', reveal: { headline: 'Surprise' } }).expect(200);
      expect(((await client.publish().expect(200)).body as GiftEditorView).slug).toBe(slug);
      await http().get(`/public/gifts/${slug}`).expect(200);
    });

    it('still upgrades when the custom link was taken, and lets the creator pick another once', async () => {
      const taken = await publishedGift();
      const { gift, client } = await publishedGift();
      const orderId = `order-${randomUUID()}`;

      await pay(gift.id, taken.gift.slug, orderId);
      const view = (await client.get()).body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', slug: gift.slug, customSlugPending: true });

      const chosen = `second-choice-${randomUUID().slice(0, 8)}`;
      await client.changeSlug(chosen).expect(200);

      // The same payment delivered again must not reopen the choice or move the gift.
      await pay(gift.id, taken.gift.slug, orderId);
      expect((await client.get()).body).toMatchObject({ slug: chosen, customSlugPending: false });
      await client.changeSlug('third-choice').expect(402);
    });

    it('ignores an old order that is delivered again after a newer one', async () => {
      const { gift, client } = await publishedGift();
      const [first, second] = [
        `first-${randomUUID().slice(0, 8)}`,
        `second-${randomUUID().slice(0, 8)}`,
      ];
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
      const slug = `mi-regalo-${randomUUID().slice(0, 8)}`;
      await pay(gift.id, slug, orderId);
      await pay(gift.id, slug, orderId);
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM', slug });

      await client.remove().expect(204);
      await expect(pay(gift.id, null)).resolves.toBeUndefined();
    });

    it('rejects an invalid custom link but keeps the upgrade', async () => {
      const { gift, client } = await publishedGift();
      await pay(gift.id, 'create');
      expect((await client.get()).body).toMatchObject({
        plan: 'PREMIUM',
        slug: gift.slug,
        customSlugPending: true,
      });
    });
  });

  describe('slugs', () => {
    it('reports availability', async () => {
      const { gift } = await publishedGift();
      const check = async (slug: string) =>
        (await http().get('/gifts/slug-availability').query({ slug }).expect(200)).body;
      expect(await check('te-quiero-ana')).toEqual({ slug: 'te-quiero-ana', available: true });
      expect(await check(gift.slug)).toMatchObject({ available: false, reason: 'TAKEN' });
      expect(await check('create')).toMatchObject({ available: false, reason: 'RESERVED' });
      expect(await check('Not Valid')).toMatchObject({ available: false, reason: 'INVALID' });
    });

    it('only lets a gift change its link when a paid custom link is pending', async () => {
      const { gift, client } = await publishedGift();
      const refused = await client.changeSlug('my-own-link').expect(402);
      expect(refused.body.details).toEqual({ capability: 'CUSTOM_SLUG' });

      const taken = await publishedGift();
      await app
        .get(PrismaService)
        .gift.update({ where: { id: gift.id }, data: { customSlugPending: true } });
      expect((await client.changeSlug(taken.gift.slug).expect(409)).body.code).toBe('SLUG_TAKEN');
      await client.changeSlug('create').expect(400);

      const changed = (await client.changeSlug('my-own-link-2').expect(200)).body as GiftEditorView;
      expect(changed).toMatchObject({ slug: 'my-own-link-2', customSlugPending: false });
      await http().get('/public/gifts/my-own-link-2').expect(200);
      await client.changeSlug('another-one').expect(402);
      // The link it was published with still works and stays reserved.
      expect((await http().get(`/public/gifts/${gift.slug}`).expect(200)).body.slug).toBe(
        'my-own-link-2',
      );
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
