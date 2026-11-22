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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
