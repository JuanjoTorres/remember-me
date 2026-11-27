import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiErrorSchema,
  GIFT_CODE_LENGTH,
  type GiftEditorView,
  randomCode,
} from '@remember-me/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as slugGenerator from '../src/modules/gifts/slug-generator.js';
import { PaymentSucceededEvent } from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { createTestApp } from './create-test-app.js';
import { createGift, customLinkOf, editor, freeName, photoCard } from './helpers.js';

// The real generator, unless a test lines up what it must return next.
vi.mock('../src/modules/gifts/slug-generator.js', async (original) => {
  const actual = await original<typeof slugGenerator>();
  return {
    generateSlug: vi.fn(actual.generateSlug),
    generateCustomLink: vi.fn(actual.generateCustomLink),
  };
});

const MISS_LIMIT = 4;

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

  beforeAll(async () => {
    process.env['LINK_LOOKUP_MISS_LIMIT'] = String(MISS_LIMIT);
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
    it('are a long random code with a digit, the same before and after publication', async () => {
      const draft = await createGift(app);
      expect(draft.gift.slug).toMatch(/^[a-z0-9]{8}$/);
      expect(draft.gift.slug).toMatch(/[0-9]/);
      expect(draft.gift.slug).toHaveLength(GIFT_CODE_LENGTH);
      const { gift } = await publishedGift('Laura');
      expect(gift.slug).toMatch(/^[a-z0-9]{8}$/);
      expect(gift.slug).not.toContain('laura');
    });

    it('are not repeated between gifts', async () => {
      const slugs = await Promise.all(
        Array.from({ length: 8 }, async () => (await publishedGift('Laura')).gift.slug),
      );
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('never give a new gift a link another gift once had: its printed QR code keeps opening that gift', async () => {
      const first = await publishedGift('Laura');
      const formerLink = first.gift.slug;
      const name = freeName('laura-y-ana');
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: first.gift.id,
        customSlug: name,
      });
      const custom = (await first.client.get()).body.slug as string;
      expect(custom).toMatch(customLinkOf(name));

      // Chance hands the next gift the very code the first one used to have.
      const fresh = randomCode(GIFT_CODE_LENGTH);
      vi.mocked(slugGenerator.generateSlug)
        .mockReturnValueOnce(formerLink)
        .mockReturnValueOnce(fresh);
      const draft = await createGift(app);
      expect(draft.gift.slug).toBe(fresh);

      const secondClient = editor(app, draft.gift.id, draft.editToken);
      await secondClient.addCard(photoCard()).expect(201);
      await secondClient
        .update({ recipientName: 'Laura', reveal: { headline: 'Porto' } })
        .expect(200);
      const second = (await secondClient.publish().expect(200)).body as GiftEditorView;
      expect(second.slug).toBe(fresh);

      const from = visitor();
      expect((await open(formerLink, from).expect(200)).body.slug).toBe(custom);
      expect((await open(custom, from).expect(200)).body.slug).toBe(custom);
      expect((await open(fresh, from).expect(200)).body.slug).toBe(fresh);
    });
  });

  describe('trying links', () => {
    it('refuses a visitor who keeps opening links that do not exist, also for a real gift', async () => {
      const { gift } = await publishedGift();
      const from = visitor();
      for (let i = 0; i < MISS_LIMIT; i += 1) {
        await open(randomCode(GIFT_CODE_LENGTH), from).expect(404);
      }

      const refused = await open(randomCode(GIFT_CODE_LENGTH), from).expect(429);
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
      await open(randomCode(GIFT_CODE_LENGTH), from).expect(404);
      await open(gift.slug, from).expect(200);
    });

    it('counts a wrong name behind a real code as a miss', async () => {
      const from = visitor();
      for (let i = 0; i < MISS_LIMIT; i += 1) await open('7k2m/for/laura', from).expect(404);
      await open('7k2m/for/laura', from).expect(429);
    });

    it('does not hold against a visitor an address that is not even the shape of a link', async () => {
      const { gift } = await publishedGift();
      const from = visitor();
      // A mistyped page, a crawler asking for a file, a link in the old format.
      for (let i = 0; i < MISS_LIMIT; i += 1) {
        for (const address of ['privcy', 'wp-login.php', 'laura-x9k2bd7m', 'luis/for/ana']) {
          await open(address, from).expect(404);
        }
      }
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
        await open(randomCode(GIFT_CODE_LENGTH), `2001:db8:77:1::${i + 1}`).expect(404);
      }
      await open(gift.slug, '2001:db8:77:1:aaaa:bbbb:cccc:dddd').expect(429);
      // Another network is another visitor.
      await open(gift.slug, '2001:db8:77:2::1').expect(200);
    });

    it('does not hold one visitor responsible for another', async () => {
      const { gift } = await publishedGift();
      const [guesser, recipient] = ['198.51.100.7', '198.51.100.8'];
      for (let i = 0; i < MISS_LIMIT; i += 1) {
        await open(randomCode(GIFT_CODE_LENGTH), guesser).expect(404);
      }
      await open(gift.slug, guesser).expect(429);
      await open(gift.slug, recipient).expect(200);
    });
  });

  describe('custom links', () => {
    it('never give two gifts the same link, even when chance draws the same code for the same name', async () => {
      const [first, second] = [await publishedGift(), await publishedGift()];
      const name = freeName('la-misma');
      const buy = (giftId: string) =>
        app.get(EventBus).publish(PaymentSucceededEvent, {
          orderId: `order-${randomUUID()}`,
          giftId,
          customSlug: name,
        });
      await buy(first.gift.id);
      const taken = (await first.client.get()).body.slug as string;

      // The second gift is dealt the very link of the first one, then another.
      vi.mocked(slugGenerator.generateCustomLink).mockReturnValueOnce(taken);
      await buy(second.gift.id);
      const other = (await second.client.get()).body.slug as string;
      expect(other).toMatch(customLinkOf(name));
      expect(other).not.toBe(taken);

      const from = visitor();
      expect((await open(taken, from).expect(200)).body.slug).toBe(taken);
      expect((await open(other, from).expect(200)).body.slug).toBe(other);
    });
  });
});
