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
import {
  PaymentsService,
  SESSION_CHECK_INTERVAL_MS,
} from '../src/modules/payments/payments.service.js';
import { STRIPE_CLIENT } from '../src/modules/payments/stripe-payment-gateway.js';
import {
  GiftDeletedEvent,
  PaymentSucceededEvent,
  type PaymentSucceededPayload,
} from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, freeCustomLink, photoCard } from './helpers.js';

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
/** The address the buyer types in Stripe Checkout. */
const BUYER_EMAIL = 'buyer@example.com';
const expiredSessions = new Set<string>();
/** The next session creation, which the stand-in keeps unanswered until the test lets it go. */
let heldSessionCreation: { arrive: () => void; released: Promise<void> } | null = null;

/**
 * Makes the stand-in hold back its answer to the next session creation. Tests about simultaneous
 * requests decide the order of events with this, never with a delay: `arrived` resolves once the
 * request is at Stripe, and nothing is answered before `release` is called.
 */
function holdNextSessionCreation(): { arrived: Promise<void>; release: () => void } {
  let arrive!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  heldSessionCreation = { arrive, released };
  return { arrived, release };
}
/** How many of the next session creations the stand-in answers with an error. */
let failSessionCreations = 0;

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
      const unavailable = () => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'api_error', message: 'unavailable' } }));
      };
      const json = (payload: object) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.method === 'POST' && path === '/v1/checkout/sessions') {
        const id = `cs_test_${randomUUID().replaceAll('-', '')}`;
        const fail = failSessionCreations > 0;
        if (fail) failSessionCreations -= 1;
        const answer = () =>
          fail
            ? unavailable()
            : json({
                id,
                object: 'checkout.session',
                url: `https://checkout.stripe.test/c/pay/${id}`,
              });
        const held = heldSessionCreation;
        if (!held) return answer();
        heldSessionCreation = null;
        held.arrive();
        return void held.released.then(answer);
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
          customer_details: { email: BUYER_EMAIL },
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

  /**
   * Tells when a checkout request starts waiting for the page that an earlier request is still
   * creating. It only observes the service; the wait itself runs unchanged.
   */
  const nextRequestWaitingForAPage = (): { started: Promise<void>; stop: () => void } => {
    const service = app.get(PaymentsService) as unknown as {
      checkoutUrlOf(orderId: string): Promise<string | null>;
    };
    const wait = service.checkoutUrlOf.bind(service);
    let start!: () => void;
    const started = new Promise<void>((resolve) => (start = resolve));
    const spy = vi.spyOn(service, 'checkoutUrlOf').mockImplementation((orderId) => {
      start();
      return wait(orderId);
    });
    return { started, stop: () => spy.mockRestore() };
  };

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
        customer_details: { email: BUYER_EMAIL },
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
      const { orderId } = await startCheckout(gift, '7k2m/for/te-quiero-ana');
      const form = Object.fromEntries(stripeCalls.at(-1)!.form);
      expect(form).toMatchObject({
        'line_items[0][price]': 'price_premium_test',
        'line_items[1][price]': 'price_custom_slug_test',
        'line_items[1][quantity]': '1',
        'metadata[customSlug]': '7k2m/for/te-quiero-ana',
      });
      expect(
        await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ).toMatchObject({
        includeCustomSlug: true,
        customSlug: '7k2m/for/te-quiero-ana',
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
      // Not a custom link: a reserved name, a word instead of a code, the old format, and the
      // generated link the gift already has.
      for (const customSlug of [
        'create',
        '7k2m/for/create',
        'luis/for/ana',
        'ana-luis-x9k2',
        gift.slug,
      ]) {
        await checkout(gift.grant, { ...base, includeCustomSlug: true, customSlug }).expect(400);
      }
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

    it('waits for the page that a request sent a moment earlier is still creating', async () => {
      const { gift } = await readyGift();
      const body = { giftId: gift.id, ...urls(gift.id) };
      // Stripe answers the first tap only once the second one is waiting for its page.
      const stripe = holdNextSessionCreation();
      const waiting = nextRequestWaitingForAPage();
      try {
        const first = checkout(gift.grant, body).then((response) => response);
        await stripe.arrived;
        const second = checkout(gift.grant, body).then((response) => response);
        await waiting.started;
        stripe.release();
        expect((await second).status).toBe(201);
        expect((await second).body).toEqual((await first).body);
      } finally {
        stripe.release();
        waiting.stop();
      }
      expect(stripeCalls.filter((call) => call.path === '/v1/checkout/sessions')).toHaveLength(1);
      expect(await prisma().paymentOrder.count({ where: { giftId: gift.id } })).toBe(1);
    });

    it('lets the customer try again at once after Stripe failed, with a true message', async () => {
      const { gift } = await readyGift();
      const body = { giftId: gift.id, ...urls(gift.id) };
      failSessionCreations = 1;
      const failed = await checkout(gift.grant, body).expect(500);
      // Not "already paid": nothing was paid.
      expect(failed.body.code).toBe('INTERNAL');
      const orders = () => prisma().paymentOrder.findMany({ where: { giftId: gift.id } });
      expect((await orders()).map((order) => order.status)).toEqual(['EXPIRED']);

      const waiting = nextRequestWaitingForAPage();
      let waited = false;
      void waiting.started.then(() => (waited = true));
      const retried = await checkout(gift.grant, body).expect(201);
      waiting.stop();
      // Answered straight away, not after waiting for the page of the failed attempt.
      expect(waited).toBe(false);
      expect(retried.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      expect((await orders()).map((order) => order.status).sort()).toEqual(['EXPIRED', 'PENDING']);
    });

    it('opens its own checkout when the request it was waiting for fails', async () => {
      const { gift } = await readyGift();
      const body = { giftId: gift.id, ...urls(gift.id) };
      const stripe = holdNextSessionCreation();
      const waiting = nextRequestWaitingForAPage();
      failSessionCreations = 1;
      try {
        const first = checkout(gift.grant, body).then((response) => response);
        await stripe.arrived;
        const second = checkout(gift.grant, body).then((response) => response);
        await waiting.started;
        stripe.release();
        expect((await first).status).toBe(500);
        const answered = await second;
        expect(answered.status).toBe(201);
        expect(answered.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      } finally {
        stripe.release();
        waiting.stop();
        failSessionCreations = 0;
      }
    });

    it('leaves one payable session when a request for another link overtakes a slow one', async () => {
      const { gift } = await readyGift();
      const body = { giftId: gift.id, ...urls(gift.id) };
      const slug = freeCustomLink('otro-enlace');
      // Only the first creation is held: the newer request gets its page while the slow one waits.
      const stripe = holdNextSessionCreation();
      try {
        const slow = checkout(gift.grant, body).then((response) => response);
        await stripe.arrived;
        const newer = await checkout(gift.grant, {
          ...body,
          includeCustomSlug: true,
          customSlug: slug,
        }).expect(201);
        stripe.release();
        // The overtaken request gets no page, and the session Stripe made for it is expired.
        expect((await slow).status).toBe(500);
        const created = stripeCalls.filter((call) => call.path === '/v1/checkout/sessions');
        const expired = stripeCalls.filter((call) => call.path.endsWith('/expire'));
        expect(created).toHaveLength(2);
        expect(expired).toHaveLength(1);
        expect(expired[0]!.path).not.toContain(newer.body.checkoutUrl.split('/').pop());
        expect(
          await prisma().paymentOrder.findMany({
            where: { giftId: gift.id, status: 'PENDING' },
          }),
        ).toMatchObject([{ id: newer.body.orderId, customSlug: slug }]);
      } finally {
        stripe.release();
      }
    });

    it('replaces an order whose checkout page was never created', async () => {
      const { gift } = await readyGift();
      // A request that died after reserving the order, long enough ago not to be in flight.
      const dead = await prisma().paymentOrder.create({
        data: { giftId: gift.id, createdAt: new Date(Date.now() - 60_000) },
      });
      const { orderId } = await startCheckout(gift);
      expect(orderId).not.toBe(dead.id);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: dead.id } })).status,
      ).toBe('EXPIRED');
    });

    it('expires the previous session when the creator changes the order', async () => {
      const { gift } = await readyGift();
      const first = await startCheckout(gift);
      const second = await startCheckout(gift, '7k2m/for/otro-enlace-mejor');

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

      expect(published).toEqual([
        { orderId, giftId: gift.id, customSlug: null, customerEmail: BUYER_EMAIL },
      ]);
      expect(
        await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ).toMatchObject({
        status: 'PAID',
        amountTotal: 499,
        currency: 'eur',
        customerEmail: BUYER_EMAIL,
      });
      // The gift keeps the buyer's address (for the anniversary email) and never expires.
      expect(await prisma().gift.findUniqueOrThrow({ where: { id: gift.id } })).toMatchObject({
        customerEmail: BUYER_EMAIL,
        expiresAt: null,
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
      const slug = freeCustomLink('te-quiero');
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
      const slug = freeCustomLink('nuestro-viaje');
      const { orderId, sessionId } = await startCheckout(gift, slug);

      const rival = await readyGift();
      const rivalCheckout = await startCheckout(rival.gift, slug);
      await deliver(paidEvent(rivalCheckout.orderId, rivalCheckout.sessionId)).expect(200);

      await deliver(paidEvent(orderId, sessionId)).expect(200);
      const view = (await client.get()).body as GiftEditorView;
      expect(view).toMatchObject({ plan: 'PREMIUM', status: 'PUBLISHED', customSlugPending: true });
      expect(view.slug).not.toBe(slug);
      await client.changeSlug(freeCustomLink('nuestro-viaje')).expect(200);
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

    it('changes nothing when a later order buys the custom link the gift already has', async () => {
      const { gift, client } = await readyGift();
      const slug = freeCustomLink('ya-es-mio');
      const { orderId, sessionId } = await startCheckout(gift, slug);
      await deliver(paidEvent(orderId, sessionId)).expect(200);

      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: gift.id,
        customSlug: slug,
      });
      expect((await client.get()).body).toMatchObject({
        status: 'PUBLISHED',
        slug,
        customSlugPending: false,
      });
      await http().get(`/public/gifts/${slug}`).expect(200);
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
      expect(published).toEqual([
        { orderId, giftId: gift.id, customSlug: null, customerEmail: BUYER_EMAIL },
      ]);
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

  describe('personal data', () => {
    it("forgets the buyer's email when the gift is deleted, and keeps the order", async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      const order = () => prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect((await order()).customerEmail).toBe(BUYER_EMAIL);

      await client.remove().expect(204);
      expect(await order()).toMatchObject({
        status: 'PAID',
        amountTotal: 499,
        customerEmail: null,
      });

      // The announcement can be delivered more than once.
      await app.get(EventBus).publish(GiftDeletedEvent, { giftId: gift.id });
      expect((await order()).customerEmail).toBeNull();
    });

    it('keeps no address on an order that could not be delivered', async () => {
      const { gift, client } = await readyGift();
      const { orderId, sessionId } = await startCheckout(gift);
      // The gift is deleted while the customer is still at the checkout.
      await client.remove().expect(204);
      await deliver(paidEvent(orderId, sessionId)).expect(200);
      expect(
        await prisma().paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ).toMatchObject({ status: 'REFUND_DUE', amountTotal: 499, customerEmail: null });
    });

    it('leaves the orders of other gifts alone', async () => {
      const kept = await readyGift();
      const keptCheckout = await startCheckout(kept.gift);
      await deliver(paidEvent(keptCheckout.orderId, keptCheckout.sessionId)).expect(200);
      const deleted = await readyGift();
      await deleted.client.remove().expect(204);
      expect(
        (await prisma().paymentOrder.findUniqueOrThrow({ where: { id: keptCheckout.orderId } }))
          .customerEmail,
      ).toBe(BUYER_EMAIL);
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
