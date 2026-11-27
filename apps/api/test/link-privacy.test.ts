import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ApiErrorSchema, type GiftEditorView } from '@remember-me/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as slugGenerator from '../src/modules/gifts/slug-generator.js';
import { PaymentSucceededEvent } from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, photoCard } from './helpers.js';

// The real generator, unless a test lines up what it must return next.
vi.mock('../src/modules/gifts/slug-generator.js', async (original) => {
  const actual = await original<typeof slugGenerator>();
  return { generateSlug: vi.fn(actual.generateSlug) };
});

const MISS_LIMIT = 4;
const CHECK_LIMIT = 5;

describe('link privacy', () => {
  let app: INestApplication;
  const saved = { ...process.env };
  /**
   * Each call is a visitor nobody has seen before: the API sits behind one proxy that reports the
   * address, and budgets last longer than this file runs, so an address is never handed out twice.
   */
  let visitors = 0;
  const visitor = () => {
    visitors += 1;
    return `203.0.113.${visitors}`;
  };
  const open = (slug: string, from: string) =>
    request(app.getHttpServer()).get(`/public/gifts/${slug}`).set('X-Forwarded-For', from);
  const check = (slug: string, from: string) =>
    request(app.getHttpServer())
      .get('/gifts/check-slug')
      .query({ slug })
      .set('X-Forwarded-For', from);

  beforeAll(async () => {
    process.env['LINK_LOOKUP_MISS_LIMIT'] = String(MISS_LIMIT);
    process.env['SLUG_CHECK_LIMIT'] = String(CHECK_LIMIT);
    process.env['TRUST_PROXY_HOPS'] = '1';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  async function publishedGift(recipientName = 'Laura') {
    const { gift, editToken } = await createGift(app);
    const client = editor(app, gift.id, editToken);
    await client.addCard(photoCard()).expect(201);
    await client.update({ recipientName, reveal: { headline: 'Lisbon' } }).expect(200);
    return { client, gift: (await client.publish().expect(200)).body as GiftEditorView };
  }

  describe('generated links', () => {
    it('end with a long random code, for a draft and for a published gift', async () => {
      const draft = await createGift(app);
      expect(draft.gift.slug).toMatch(/^gift-[a-z0-9]{8}$/);
      const { gift } = await publishedGift('Laura');
      expect(gift.slug).toMatch(/^laura-[a-z0-9]{8}$/);
    });

    it('are not repeated between gifts of the same name', async () => {
      const slugs = await Promise.all(
        Array.from({ length: 8 }, async () => (await publishedGift('Laura')).gift.slug),
      );
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('never reuse a link another gift once had: its printed QR code keeps opening that gift', async () => {
      const first = await publishedGift('Laura');
      const formerLink = first.gift.slug;
      const custom = `laura-y-ana-${randomUUID().slice(0, 8)}`;
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: first.gift.id,
        customSlug: custom,
      });
      expect((await first.client.get()).body.slug).toBe(custom);

      // Chance hands the next gift, on publication, the very link the first one used to have.
      const draft = await createGift(app);
      const secondClient = editor(app, draft.gift.id, draft.editToken);
      await secondClient.addCard(photoCard()).expect(201);
      await secondClient
        .update({ recipientName: 'Laura', reveal: { headline: 'Porto' } })
        .expect(200);
      const fresh = `laura-${randomUUID().slice(0, 8)}`;
      vi.mocked(slugGenerator.generateSlug)
        .mockReturnValueOnce(formerLink)
        .mockReturnValueOnce(fresh);
      const second = { gift: (await secondClient.publish().expect(200)).body as GiftEditorView };

      expect(second.gift.slug).toBe(fresh);
      const from = visitor();
      expect((await open(formerLink, from).expect(200)).body.slug).toBe(custom);
      expect((await open(fresh, from).expect(200)).body.slug).toBe(fresh);
    });

    it('never give a new draft a link another gift once had', async () => {
      const first = await publishedGift('Laura');
      const formerLink = first.gift.slug;
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: first.gift.id,
        customSlug: `laura-y-ana-${randomUUID().slice(0, 8)}`,
      });
      vi.mocked(slugGenerator.generateSlug).mockReturnValueOnce(formerLink);
      const draft = await createGift(app);
      expect(draft.gift.slug).not.toBe(formerLink);
      expect(draft.gift.slug).toMatch(/^gift-[a-z0-9]{8}$/);
    });
  });

  describe('trying links', () => {
    it('refuses a visitor who keeps opening links that do not exist, also for a real gift', async () => {
      const { gift } = await publishedGift();
      const from = visitor();
      for (let i = 0; i < MISS_LIMIT; i += 1) {
        await open(`laura-${randomUUID().slice(0, 8)}`, from).expect(404);
      }

      const refused = await open(`laura-${randomUUID().slice(0, 8)}`, from).expect(429);
      expect(ApiErrorSchema.parse(refused.body).code).toBe('RATE_LIMITED');
      expect(refused.body.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.body.details.retryAfterSeconds).toBeLessThanOrEqual(600);
      // Being refused must not tell whether a link exists: a real one is refused the same way.
      expect((await open(gift.slug, from).expect(429)).body).toEqual(refused.body);
    });

    it('does not count links that exist: a QR code can be opened as often as people like', async () => {
      const { gift } = await publishedGift();
      const from = visitor();
      for (let i = 0; i < MISS_LIMIT * 3; i += 1) await open(gift.slug, from).expect(200);
      // A typo or two in between is not held against anyone.
      await open('laura-typo', from).expect(404);
      await open(gift.slug, from).expect(200);
    });

    it('counts a draft as a link that does not exist', async () => {
      const draft = await createGift(app);
      const from = visitor();
      for (let i = 0; i < MISS_LIMIT; i += 1) await open(draft.gift.slug, from).expect(404);
      await open(draft.gift.slug, from).expect(429);
    });

    it('counts every address of one IPv6 network as the same visitor', async () => {
      const { gift } = await publishedGift();
      for (let i = 0; i < MISS_LIMIT; i += 1) {
        await open(`nobody-${i}-home`, `2001:db8:77:1::${i + 1}`).expect(404);
      }
      await open(gift.slug, '2001:db8:77:1:aaaa:bbbb:cccc:dddd').expect(429);
      // Another network is another visitor.
      await open(gift.slug, '2001:db8:77:2::1').expect(200);
    });

    it('does not hold one visitor responsible for another', async () => {
      const { gift } = await publishedGift();
      const [guesser, recipient] = ['198.51.100.7', '198.51.100.8'];
      for (let i = 0; i < MISS_LIMIT; i += 1) await open(`nobody-${i}-home`, guesser).expect(404);
      await open(gift.slug, guesser).expect(429);
      await open(gift.slug, recipient).expect(200);
    });
  });

  describe('checking which links are taken', () => {
    it('refuses a client that checks too many, whether they were free or taken', async () => {
      const { gift } = await publishedGift();
      const from = visitor();
      for (let i = 0; i < CHECK_LIMIT - 1; i += 1) {
        await check(`laura-${randomUUID().slice(0, 8)}`, from).expect(200);
      }
      expect((await check(gift.slug, from).expect(200)).body.reason).toBe('TAKEN');

      const refused = await check(gift.slug, from).expect(429);
      expect(refused.body.code).toBe('RATE_LIMITED');
      await check(`laura-${randomUUID().slice(0, 8)}`, from).expect(429);
    });

    it('keeps the two budgets apart: checking links does not stop a visitor opening a gift', async () => {
      const { gift } = await publishedGift();
      const from = visitor();
      for (let i = 0; i < CHECK_LIMIT; i += 1) await check('laura-x9k2', from).expect(200);
      await check('laura-x9k2', from).expect(429);
      await open(gift.slug, from).expect(200);
    });
  });
});
