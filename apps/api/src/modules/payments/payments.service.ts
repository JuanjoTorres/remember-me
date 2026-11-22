import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  PricesResponse,
} from '@remember-me/shared-types';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { GiftGrantClaims } from '../../shared/auth/gift-grant.service.js';
import { PaymentSucceededEvent, PaymentUnappliedEvent } from '../../shared/events/contracts.js';
import { EventBus } from '../../shared/events/event-bus.js';
import { AppError } from '../../shared/http/app-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { type PaymentEvent, PaymentGateway } from './payment-gateway.js';

const PRICES_TTL_MS = 10 * 60 * 1000;
/** Stripe sessions live 24 hours; an open one is handed out again for a little less than that. */
const SESSION_REUSE_MS = 23 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger('Payments');
  private prices?: { value: PricesResponse; expiresAt: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly events: EventBus,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(PaymentUnappliedEvent, 'payments', ({ orderId, reason }) =>
      this.markRefundDue(orderId, reason),
    );
  }

  async createCheckoutSession(
    grant: GiftGrantClaims,
    request: CheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse> {
    if (grant.giftId !== request.giftId) {
      throw new AppError('UNAUTHORIZED', 'The grant does not belong to this gift');
    }
    if (grant.plan === 'PREMIUM')
      throw new AppError('CONFLICT', 'This gift already has the full experience');
    for (const url of [request.successUrl, request.cancelUrl]) {
      // Only our own site may receive the customer back, so the endpoint is not an open redirect.
      if (new URL(url).origin !== this.env.WEB_ORIGIN) {
        throw new AppError('VALIDATION_ERROR', 'Redirect URLs must belong to the web app');
      }
    }

    const customSlug = request.includeCustomSlug ? (request.customSlug ?? null) : null;

    // One gift, one open checkout. The grant can be up to 30 minutes old and the creator may have
    // several tabs open, so the decision is made on this module's own orders, under a per-gift lock.
    const { order, reused, replaced } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'checkout:' + request.giftId}))`;
      const existing = await tx.paymentOrder.findMany({
        where: { giftId: request.giftId, status: { in: ['PAID', 'PENDING'] } },
      });
      if (existing.some((candidate) => candidate.status === 'PAID')) {
        throw new AppError('CONFLICT', 'This gift already has the full experience');
      }
      const reusable = existing.find(
        (candidate) =>
          candidate.checkoutUrl !== null &&
          candidate.customSlug === customSlug &&
          candidate.createdAt.getTime() > Date.now() - SESSION_REUSE_MS,
      );
      if (reusable) return { order: reusable, reused: true, replaced: [] };

      await tx.paymentOrder.updateMany({
        where: { id: { in: existing.map((candidate) => candidate.id) } },
        data: { status: 'EXPIRED' },
      });
      const created = await tx.paymentOrder.create({
        data: { giftId: request.giftId, includeCustomSlug: customSlug !== null, customSlug },
      });
      return { order: created, reused: false, replaced: existing };
    });
    if (reused && order.checkoutUrl) return { orderId: order.id, checkoutUrl: order.checkoutUrl };

    // Sessions of replaced orders must stop being payable, or an old tab could still charge.
    for (const old of replaced) {
      if (old.stripeSessionId) await this.gateway.expireCheckoutSession(old.stripeSessionId);
    }
    const session = await this.gateway.createCheckoutSession({
      orderId: order.id,
      giftId: request.giftId,
      priceIds: [
        this.env.STRIPE_PRICE_ID_PREMIUM,
        ...(customSlug !== null ? [this.env.STRIPE_PRICE_ID_CUSTOM_SLUG] : []),
      ],
      customSlug,
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
    });
    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id, checkoutUrl: session.url },
    });
    return { orderId: order.id, checkoutUrl: session.url };
  }

  /** The gift of a paid order no longer exists: flag the order so that the money is returned. */
  async markRefundDue(orderId: string, reason: string): Promise<void> {
    if (!isUuid(orderId)) return;
    const { count } = await this.prisma.paymentOrder.updateMany({
      where: { id: orderId, status: 'PAID' },
      data: { status: 'REFUND_DUE' },
    });
    if (count > 0)
      this.logger.error(`REFUND DUE: order ${orderId} could not be applied (${reason})`);
  }

  async getPrices(now = Date.now()): Promise<PricesResponse> {
    if (!this.prices || this.prices.expiresAt <= now) {
      const [premium, customSlug] = await Promise.all([
        this.gateway.getPrice(this.env.STRIPE_PRICE_ID_PREMIUM),
        this.gateway.getPrice(this.env.STRIPE_PRICE_ID_CUSTOM_SLUG),
      ]);
      this.prices = { value: { premium, customSlug }, expiresAt: now + PRICES_TTL_MS };
    }
    return this.prices.value;
  }

  /**
   * Handles one webhook delivery. Stripe delivers at least once and retries on any non-2xx answer,
   * so an event that was fully handled is skipped, and one that failed half-way runs again.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    if (!rawBody) throw new AppError('VALIDATION_ERROR', 'Missing request body');
    const event = this.gateway.parseWebhook(rawBody, signature);

    // `createMany` + `skipDuplicates` is a single atomic statement, unlike an upsert, so two
    // simultaneous deliveries of the same event cannot collide on the primary key.
    await this.prisma.paymentWebhookLog.createMany({
      data: [{ eventId: event.id, type: event.type }],
      skipDuplicates: true,
    });
    const log = await this.prisma.paymentWebhookLog.findUniqueOrThrow({
      where: { eventId: event.id },
    });
    if (log.processedAt) return;

    await this.process(event);
    await this.prisma.paymentWebhookLog.update({
      where: { eventId: event.id },
      data: { processedAt: new Date() },
    });
  }

  private async process(event: PaymentEvent): Promise<void> {
    if (event.kind === 'ignored') return;

    const order = await this.prisma.paymentOrder.findFirst({
      where:
        event.orderId && isUuid(event.orderId)
          ? { id: event.orderId }
          : { stripeSessionId: event.sessionId },
    });
    if (!order) {
      // Not one of ours (for example another product on the same Stripe account).
      this.logger.warn(`No order for Stripe session ${event.sessionId} (event ${event.id})`);
      return;
    }

    if (event.kind === 'expired') {
      await this.prisma.paymentOrder.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return;
    }

    const alreadyPaid = await this.prisma.paymentOrder.findFirst({
      where: { giftId: order.giftId, status: 'PAID', NOT: { id: order.id } },
    });
    const paid = {
      paidAt: order.paidAt ?? new Date(),
      stripeSessionId: event.sessionId,
      amountTotal: event.amountTotal,
      currency: event.currency,
    };
    if (alreadyPaid || order.status === 'REFUND_DUE') {
      // A second payment for the same gift got through (a session opened before the first payment).
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: { ...paid, status: 'REFUND_DUE' },
      });
      this.logger.error(`REFUND DUE: order ${order.id} paid again for gift ${order.giftId}`);
      return;
    }

    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: { ...paid, status: 'PAID' },
    });
    // What was bought comes from our own order, not from the webhook payload.
    await this.events.publish(PaymentSucceededEvent, {
      orderId: order.id,
      giftId: order.giftId,
      customSlug: order.customSlug,
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
