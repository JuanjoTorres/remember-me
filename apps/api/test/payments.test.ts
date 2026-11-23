import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import {
  CheckoutSessionResponseSchema,
  type GiftEditorView,
  PricesResponseSchema,
} from '@remember-me/shared-types';
import request from 'supertest';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_CHECK_INTERVAL_MS } from '../src/modules/payments/payments.service.js';
import { STRIPE_CLIENT } from '../src/modules/payments/stripe-payment-gateway.js';
import {
  PaymentSucceededEvent,
  type PaymentSucceededPayload,
} from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, photoCard } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_integration_test_secret';
const WEB = 'http://localhost:3000';

interface StripeCall {
  method: string;
  path: string;
  form: URLSearchParams;
  idempotencyKey: string | undefined;
}

/** A stand-in for api.stripe.com that records what the real Stripe SDK sends. */
/** Sessions the stand-in reports as paid when they are retrieved. */
const paidSessions = new Set<string>();
const expiredSessions = new Set<string>();

function startFakeStripe(calls: StripeCall[]): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0] ?? '';
      calls.push({
        method: req.method ?? '',
        path,
        form: new URLSearchParams(body),
        idempotencyKey: req.headers['idempotency-key'] as string | undefined,
      });
      const json = (payload: object) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.method === 'POST' && path === '/v1/checkout/sessions') {
        const id = `cs_test_${randomUUID().replaceAll('-', '')}`;
        return json({
          id,
          object: 'checkout.session',
          url: `https://checkout.stripe.test/c/pay/${id}`,
        });
      }
      const retrieve = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(path);
      if (req.method === 'GET' && retrieve) {
        return json({
          id: retrieve[1],
          object: 'checkout.session',
          payment_status: paidSessions.has(retrieve[1]!) ? 'paid' : 'unpaid',
          status: expiredSessions.has(retrieve[1]!) ? 'expired' : 'open',
          amount_total: 499,
          currency: 'eur',
        });
      }
      const expire = /^\/v1\/checkout\/sessions\/(cs_test_\w+)\/expire$/.exec(path);
      if (req.method === 'POST' && expire) {
        return json({ id: expire[1], object: 'checkout.session', status: 'expired' });
      }
      if (req.method === 'GET' && path === '/v1/prices/price_premium_test') {
        return json({
          id: 'price_premium_test',
          object: 'price',
          unit_amount: 499,
          currency: 'eur',
        });
      }
      if (req.method === 'GET' && path === '/v1/prices/price_custom_slug_test') {
        return json({
          id: 'price_custom_slug_test',
          object: 'price',
          unit_amount: 199,
          currency: 'eur',
        });
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'not found' } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('payments', () => {
  let app: INestApplication;
  let fakeStripe: Server;
  const stripeCalls: StripeCall[] = [];
  const published: PaymentSucceededPayload[] = [];
  const http = () => request(app.getHttpServer());
  const prisma = () => app.get(PrismaService);

  beforeAll(async () => {
    fakeStripe = await startFakeStripe(stripeCalls);
    const stripe = new Stripe('sk_test_integration', {
      host: '127.0.0.1',
      port: (fakeStripe.address() as AddressInfo).port,
      protocol: 'http',
      maxNetworkRetries: 0,
    });
    app = await createTestApp((builder) =>
      builder.overrideProvider(STRIPE_CLIENT).useValue(stripe),
    );
    app
      .get(EventBus)
      .subscribe(PaymentSucceededEvent, 'test', async (payload) => void published.push(payload));
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => fakeStripe.close(resolve));
  });

  beforeEach(() => {
    stripeCalls.length = 0;
    published.length = 0;
  });

  /** A free gift that is ready to publish, with its editor client. */
  async function readyGift() {
    const { gift, editToken } = await createGift(app);
    const client = editor(app, gift.id, editToken);
    await client.addCard(photoCard()).expect(201);
    await client.update({ recipientName: 'Ana', reveal: { headline: 'Surprise' } }).expect(200);
    const view = (await client.get().expect(200)).body as GiftEditorView;
    return { client, gift: view, grant: view.grant };
  }

  const checkout = (grant: string | undefined, body: object) => {
    const call = http().post('/payments/checkout-session');
    return (grant ? call.set('Authorization', `Bearer ${grant}`) : call).send(body);
  };

  const urls = (giftId: string) => ({
    successUrl: `${WEB}/create/${giftId}/success`,
    cancelUrl: `${WEB}/create/${giftId}`,
  });

  /** Opens a checkout session and returns the order and the Stripe session it created. */
  async function startCheckout(gift: GiftEditorView, customSlug?: string) {
    const response = await checkout(gift.grant, {
      giftId: gift.id,
      includeCustomSlug: customSlug !== undefined,
      customSlug,
      ...urls(gift.id),
    }).expect(201);
    const { orderId, checkoutUrl } = CheckoutSessionResponseSchema.parse(response.body);
    return { orderId, sessionId: checkoutUrl.split('/').pop() as string };
  }

  function sessionEvent(type: string, session: object, id = `evt_${randomUUID()}`) {
    return JSON.stringify({
      id,
      object: 'event',
      type,
      data: { object: { object: 'checkout.session', ...session } },
    });
  }

  function paidEvent(orderId: string, sessionId: string, id?: string) {
    return sessionEvent(
      'checkout.session.completed',
      {
        id: sessionId,
        payment_status: 'paid',
        amount_total: 499,
        currency: 'eur',
        client_reference_id: orderId,
        metadata: { orderId },
      },
      id,
    );
  }

  const deliver = (
    payload: string,
    signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
  ) =>
    http()
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);

  describe('prices', () => {
    it('reads the amounts from Stripe and caches them', async () => {
      const first = await http().get('/payments/prices').expect(200);
      expect(PricesResponseSchema.parse(first.body)).toEqual({
        premium: { amount: 499, currency: 'eur' },
        customSlug: { amount: 199, currency: 'eur' },
      });
      await http().get('/payments/prices').expect(200);
      expect(stripeCalls.filter((call) => call.path.startsWith('/v1/prices/'))).toHaveLength(2);
    });
  });

  describe('checkout session', () => {
    it('creates a one-time payment with a single line item and no payment method list', async () => {
      const { gift } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);

      const [call] = stripeCalls.filter((c) => c.path === '/v1/checkout/sessions');
      const form = Object.fromEntries(call!.form);
      expect(form).toMatchObject({
        mode: 'payment',
        'line_items[0][price]': 'price_premium_test',
        'line_items[0][quantity]': '1',
        client_reference_id: orderId,
        'metadata[orderId]': orderId,
        'metadata[giftId]': gift.id,
        'metadata[customSlug]': '',
        'payment_intent_data[metadata][orderId]': orderId,
        success_url: `${WEB}/create/${gift.id}/success`,
        cancel_url: `${WEB}/create/${gift.id}`,
      });
      expect(Object.keys(form).filter((key) => key.startsWith('line_items[1]'))).toEqual([]);
      expect(Object.keys(form).filter((key) => key.includes('payment_method_types'))).toEqual([]);
      expect(call!.idempotencyKey).toBe(`checkout-${orderId}`);

      const order = await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order).toMatchObject({
        giftId: gift.id,
        status: 'PENDING',
        stripeSessionId: sessionId,
        includeCustomSlug: false,
        customSlug: null,
      });
    });

    it('adds the custom link as a second line item (order bump)', async () => {
      const { gift } = await readyGift();
      const { orderId } = await startCheckout(gift, 'te-quiero-ana');
      const form = Object.fromEntries(stripeCalls.at(-1)!.form);
      expect(form).toMatchObject({
        'line_items[0][price]': 'price_premium_test',
        'line_items[1][price]': 'price_custom_slug_test',
        'line_items[1][quantity]': '1',
        'metadata[customSlug]': 'te-quiero-ana',
      });
      expect(
        await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ).toMatchObject({
        includeCustomSlug: true,
        customSlug: 'te-quiero-ana',
      });
    });

    it('rejects invalid requests without calling Stripe', async () => {
      const { gift } = await readyGift();
      const other = await readyGift();
      const base = { giftId: gift.id, ...urls(gift.id) };

      await checkout(undefined, base).expect(401);
      await checkout(other.grant, base).expect(401);
      await checkout(gift.grant, { ...base, successUrl: 'https://evil.example/thanks' }).expect(
        400,
      );
      await checkout(gift.grant, {
        ...base,
        cancelUrl: 'http://localhost:3000.evil.example/',
      }).expect(400);
      await checkout(gift.grant, { ...base, includeCustomSlug: true }).expect(400);
      await checkout(gift.grant, {
        ...base,
        includeCustomSlug: true,
        customSlug: 'Not Valid',
      }).expect(400);
      await checkout(gift.grant, { ...base, includeCustomSlug: true, customSlug: 'create' }).expect(
        400,
      );
      expect(stripeCalls).toEqual([]);
      expect(await prisma().paymentOrder.count({ where: { giftId: gift.id } })).toBe(0);
    });

    it('hands out the same open session to a second tab or a double tap', async () => {
      const { gift } = await readyGift();
      const body = { giftId: gift.id, ...urls(gift.id) };
      const responses = await Promise.all([checkout(gift.grant, body), checkout(gift.grant, body)]);
      const third = await checkout(gift.grant, body).expect(201);

      const sessions = new Set([...responses, third].map((response) => response.body.checkoutUrl));
      expect(sessions.size).toBe(1);
      expect(stripeCalls.filter((call) => call.path === '/v1/checkout/sessions')).toHaveLength(1);
      expect(await prisma().paymentOrder.count({ where: { giftId: gift.id } })).toBe(1);
    });

    it('expires the previous session when the creator changes the order', async () => {
      const { gift } = await readyGift();
      const first = await startCheckout(gift);
      const second = await startCheckout(gift, 'otro-enlace-mejor');

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(stripeCalls.map((call) => call.path)).toContain(
        `/v1/checkout/sessions/${first.sessionId}/expire`,
      );
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: first.orderId } })).status,
      ).toBe('EXPIRED');
    });

    it('refuses a new checkout with an old FREE grant once the gift is paid', async () => {
      const { gift } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      stripeCalls.length = 0;
      // `gift.grant` was issued before the payment and still says FREE.
      await checkout(gift.grant, { giftId: gift.id, ...urls(gift.id) }).expect(409);
      expect(stripeCalls).toEqual([]);
    });

    it('refuses to charge twice for a gift that is already premium', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      const premium = (await client.get()).body as GiftEditorView;
      expect(
        (await checkout(premium.grant, { giftId: gift.id, ...urls(gift.id) }).expect(409)).body
          .code,
      ).toBe('CONFLICT');
    });
  });

  describe('webhook', () => {
    it('rejects a delivery with a bad signature and changes nothing', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      const payload = paidEvent(orderId, sessionId);

      const forged = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: 'whsec_someone_else',
      });
      expect((await deliver(payload, forged).expect(401)).body.code).toBe('UNAUTHORIZED');
      await http()
        .post('/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(401);
      // A valid signature does not cover a modified body.
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      });
      await deliver(payload.replace('"paid"', '"paid" '), signature).expect(401);

      expect(published).toEqual([]);
      expect(
        await prisma().paymentWebhookLog.count({
          where: { type: 'checkout.session.completed', processedAt: null },
        }),
      ).toBe(0);
      expect((await client.get()).body).toMatchObject({ plan: 'FREE', status: 'DRAFT' });
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('PENDING');
    });

    it('upgrades and publishes the gift when the payment is confirmed', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      const response = await deliver(paidEvent(orderId, sessionId)).expect(200);
      expect(response.body).toEqual({ received: true });

      expect(published).toEqual([{ orderId, giftId: gift.id, customSlug: null }]);
      expect(
        await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ).toMatchObject({
        status: 'PAID',
        amountTotal: 499,
        currency: 'eur',
      });
      const view = (await client.get()).body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', status: 'PUBLISHED' });
      expect((await http().get(`/public/gifts/${view.slug}`).expect(200)).body.watermark).toBe(
        false,
      );
    });

    it('applies an event only once, however often Stripe delivers it', async () => {
      const { gift } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      const eventId = `evt_${randomUUID()}`;
      const payload = paidEvent(orderId, sessionId, eventId);

      const statuses = (await Promise.all([deliver(payload), deliver(payload)])).map(
        (r) => r.status,
      );
      await deliver(payload).expect(200);
      expect(statuses).toEqual([200, 200]);

      expect(await prisma().paymentWebhookLog.count({ where: { eventId } })).toBe(1);
      const log = await prisma().paymentWebhookLog.findUniqueOrThrow({ where: { eventId } });
      expect(log).toMatchObject({ type: 'checkout.session.completed' });
      expect(log.processedAt).not.toBeNull();
      // The sequential third delivery was skipped outright.
      expect(published.length).toBeLessThanOrEqual(2);
      const afterThird = published.length;
      await deliver(payload).expect(200);
      expect(published.length).toBe(afterThird);
    });

    it('applies the custom link bought with the order bump', async () => {
      const { gift, client } = await readyGift();
      const slug = `te-quiero-${randomUUID().slice(0, 8)}`;
      const { orderId, sessionId } = await startCheckout(gift, slug);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      expect((await client.get()).body).toMatchObject({
        plan: 'PREMIUM',
        slug,
        customSlugPending: false,
      });
      await http().get(`/public/gifts/${slug}`).expect(200);
    });

    it('still upgrades when the custom link was taken in the meantime', async () => {
      const { gift, client } = await readyGift();
      const slug = `nuestro-viaje-${randomUUID().slice(0, 8)}`;
      const { orderId, sessionId } = await startCheckout(gift, slug);

      const rival = await readyGift();
      const rivalCheckout = await startCheckout(rival.gift, slug);
      await deliver(paidEvent(rivalCheckout.orderId, rivalCheckout.sessionId)).expect(200);

      await deliver(paidEvent(orderId, sessionId)).expect(200);
      const view = (await client.get()).body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', status: 'PUBLISHED', customSlugPending: true });
      expect(view.slug).not.toBe(slug);
      await client.changeSlug(`${slug}-2`).expect(200);
    });

    it('waits for the money with delayed payment methods', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      const session = { id: sessionId, amount_total: 499, currency: 'eur', metadata: { orderId } };

      await deliver(
        sessionEvent('checkout.session.completed', { ...session, payment_status: 'unpaid' }),
      ).expect(200);
      expect((await client.get()).body).toMatchObject({ plan: 'FREE' });

      await deliver(
        sessionEvent('checkout.session.async_payment_succeeded', {
          ...session,
          payment_status: 'paid',
        }),
      ).expect(200);
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM' });
    });

    it('answers 500 when the upgrade fails, and finishes it when Stripe retries', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      const payload = paidEvent(orderId, sessionId);

      let fail = true;
      app.get(EventBus).subscribe(PaymentSucceededEvent, 'flaky', async (event) => {
        if (event.orderId === orderId && fail) throw new Error('database is down');
      });

      await deliver(payload).expect(500);
      fail = false;
      await deliver(payload).expect(200);
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM', status: 'PUBLISHED' });
    });

    it('marks an abandoned checkout as expired and never downgrades a paid order', async () => {
      const { gift } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      const expired = () =>
        sessionEvent('checkout.session.expired', {
          id: sessionId,
          payment_status: 'unpaid',
          metadata: { orderId },
        });

      await deliver(expired()).expect(200);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('EXPIRED');

      const second = await startCheckout(gift);
      await deliver(paidEvent(second.orderId, second.sessionId)).expect(200);
      await deliver(
        sessionEvent('checkout.session.expired', {
          id: second.sessionId,
          metadata: { orderId: second.orderId },
        }),
      ).expect(200);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: second.orderId } })).status,
      ).toBe('PAID');
    });

    it('flags a second payment for the same gift for refund instead of applying it', async () => {
      const { gift } = await readyGift();
      const first = await startCheckout(gift);
      // A second order that slipped through, e.g. a session opened before the first was paid.
      const stray = await prisma().paymentOrder.create({
        data: { giftId: gift.id, stripeSessionId: `cs_test_stray_${randomUUID()}` },
      });
      await deliver(paidEvent(first.orderId, first.sessionId)).expect(200);
      await deliver(paidEvent(stray.id, stray.stripeSessionId!)).expect(200);

      expect(published.map((event) => event.orderId)).toEqual([first.orderId]);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: stray.id } })).status,
      ).toBe('REFUND_DUE');
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: first.orderId } })).status,
      ).toBe('PAID');
    });

    it('flags the order for refund when the gift was deleted before the payment arrived', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      await client.remove().expect(204);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('REFUND_DUE');
    });

    it('makes the bought link permanent when it is the one the gift already has', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift, gift.slug);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      expect((await client.get()).body).toMatchObject({
        status: 'PUBLISHED',
        slug: gift.slug,
        customSlugPending: false,
      });
    });

    it('acknowledges events it does not use and sessions it does not know', async () => {
      await deliver(
        JSON.stringify({
          id: `evt_${randomUUID()}`,
          object: 'event',
          type: 'customer.created',
          data: { object: {} },
        }),
      ).expect(200);
      await deliver(paidEvent(randomUUID(), 'cs_test_unknown')).expect(200);
      expect(published).toEqual([]);
    });
  });

  describe('confirmation from the return page', () => {
    /** Moves the clock past the pause between two checks of the same session. */
    const later = () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + SESSION_CHECK_INTERVAL_MS + 1);
    };
    afterEach(() => vi.restoreAllMocks());

    const confirm = (grant?: string) => {
      const call = http().post('/payments/confirm');
      return grant ? call.set('Authorization', `Bearer ${grant}`) : call;
    };

    it('fulfils a paid checkout even if the webhook never arrives', async () => {
      const { gift, client } = await readyGift();
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'NONE' });

      const { orderId, sessionId } = await startCheckout(gift);
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'PENDING' });
      expect((await client.get()).body).toMatchObject({ plan: 'FREE' });

      paidSessions.add(sessionId);
      // Asked again straight away: answered without a second call to Stripe.
      stripeCalls.length = 0;
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'PENDING' });
      expect(stripeCalls).toEqual([]);

      later();
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'PAID' });
      expect(published).toEqual([{ orderId, giftId: gift.id, customSlug: null }]);
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM', status: 'PUBLISHED' });
      expect(
        await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ).toMatchObject({
        status: 'PAID',
        amountTotal: 499,
        currency: 'eur',
      });
    });

    it('announces a recorded payment again when the gift was left behind', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      paidSessions.add(sessionId);

      // The first attempt records the payment, then the upgrade fails (the database hiccups).
      let fail = true;
      app.get(EventBus).subscribe(PaymentSucceededEvent, 'flaky-confirm', async (event) => {
        if (event.orderId === orderId && fail) throw new Error('database is down');
      });
      await confirm(gift.grant).expect(500);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('PAID');

      // The page asks again: the customer must not be stuck on a paid but locked gift.
      fail = false;
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'PAID' });
      expect((await client.get()).body).toMatchObject({ plan: 'PREMIUM', status: 'PUBLISHED' });
    });

    it('closes an order whose session expired at Stripe', async () => {
      const { gift } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      expiredSessions.add(sessionId);
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'NONE' });
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('EXPIRED');
    });

    it('does not fulfil twice when the webhook also arrives, in either order', async () => {
      const { gift } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      paidSessions.add(sessionId);

      await confirm(gift.grant).expect(200);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      stripeCalls.length = 0;
      expect((await confirm(gift.grant).expect(200)).body).toEqual({ status: 'PAID' });
      // Already paid: answered from our own records, without asking Stripe again.
      expect(stripeCalls).toEqual([]);
      expect(
        await prisma().paymentOrder.count({ where: { giftId: gift.id, status: 'PAID' } }),
      ).toBe(1);
      expect(
        await prisma().paymentOrder.count({ where: { giftId: gift.id, status: 'REFUND_DUE' } }),
      ).toBe(0);
    });

    it('needs the grant of the gift', async () => {
      await confirm().expect(401);
    });
  });

  describe('delayed payment methods that fail', () => {
    it('closes the order so that the creator can start a new checkout', async () => {
      const { gift, client } = await readyGift();
      const first = await startCheckout(gift);
      const session = { id: first.sessionId, metadata: { orderId: first.orderId } };
      await deliver(
        sessionEvent('checkout.session.completed', { ...session, payment_status: 'unpaid' }),
      ).expect(200);
      await deliver(
        sessionEvent('checkout.session.async_payment_failed', {
          ...session,
          payment_status: 'unpaid',
        }),
      ).expect(200);

      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: first.orderId } })).status,
      ).toBe('EXPIRED');
      expect((await client.get()).body).toMatchObject({ plan: 'FREE' });
      // The dead session is not handed out again.
      const second = await startCheckout(gift);
      expect(second.sessionId).not.toBe(first.sessionId);
    });
  });

  describe('isolation of the payments tables', () => {
    it('has no foreign key between payment tables and the rest of the schema', async () => {
      const foreignKeys = await prisma().$queryRaw<{ table_name: string }[]>`
        SELECT tc.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND (tc.table_name LIKE 'payment_%' OR ccu.table_name LIKE 'payment_%')`;
      expect(foreignKeys).toEqual([]);
    });

    it('keeps the order when its gift is deleted', async () => {
      const { gift, client } = await readyGift();
      const { orderId } = await startCheckout(gift);
      await client.remove().expect(204);
      expect(await prisma().paymentOrder.findUnique({ where: { id: orderId } })).not.toBeNull();
    });
  });
});
