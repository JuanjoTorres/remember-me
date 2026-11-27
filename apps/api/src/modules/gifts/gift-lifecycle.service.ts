import { Inject, Injectable, Logger } from '@nestjs/common';
import { addYears, ANNIVERSARY_YEARS, LocaleSchema } from '@remember-me/shared-types';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { GiftDeletedEvent } from '../../shared/events/contracts.js';
import { EventBus } from '../../shared/events/event-bus.js';
import { Mailer } from '../../shared/mail/mailer.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { anniversaryEmail } from './anniversary-email.js';
import { publicUrlOf } from './gift.mapper.js';

const BATCH = 200;
/** Removing the files of one gift from storage may take a while; the row stays locked meanwhile. */
const DELETE_TIMEOUT_MS = 60_000;

/** What happens to gifts with time, not through a request: expiry and the anniversary email. */
@Injectable()
export class GiftLifecycleService {
  private readonly logger = new Logger('GiftLifecycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Deletes every gift whose time is up (abandoned drafts, free gifts after their year) together
   * with its files. Safe to run at any time and on several instances: a gift that is already gone
   * is skipped, and one that fails is tried again on the next run.
   */
  async deleteExpired(now = new Date()): Promise<number> {
    let deleted = 0;
    // Gifts that could not be deleted in this run: skipped, so that they do not hold back the rest.
    const failed: string[] = [];
    for (;;) {
      const expired = await this.prisma.gift.findMany({
        where: { expiresAt: { lte: now }, id: { notIn: failed } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: BATCH,
      });
      for (const { id } of expired) {
        try {
          if (await this.deleteIfExpired(id, now)) deleted += 1;
        } catch (error) {
          failed.push(id);
          this.logger.error(`Could not delete expired gift ${id}: ${String(error)}`);
        }
      }
      if (expired.length < BATCH) return deleted;
    }
  }

  /**
   * Deletes one gift if it is still expired. The row is locked first, so a payment arriving at the
   * same moment either made the gift permanent before (nothing is touched) or finds it gone
   * afterwards (and is flagged for a refund): its files are never removed from under a kept gift.
   * As in a deletion by the creator, the deletion is announced first. With the memory event bus the
   * files are removed inside this call, and a failure leaves the gift in place for the next run;
   * with the redis bus the announcement is stored and the files are removed (and retried) later.
   */
  private deleteIfExpired(giftId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM gifts WHERE id = ${giftId}::uuid FOR UPDATE`;
        const gift = await tx.gift.findUnique({
          where: { id: giftId },
          select: { expiresAt: true },
        });
        if (!gift?.expiresAt || gift.expiresAt > now) return false;
        await this.events.publish(GiftDeletedEvent, { giftId });
        await tx.gift.delete({ where: { id: giftId } });
        return true;
      },
      { timeout: DELETE_TIMEOUT_MS },
    );
  }

  /**
   * Invites the buyer of each paid gift published a year ago to relive it. Each gift gets one
   * email, ever: the gift is claimed before sending, and the claim is released if sending fails.
   */
  async sendAnniversaryEmails(now = new Date()): Promise<number> {
    if (!this.mailer.delivers) {
      // Nothing would arrive: leave the gifts unclaimed so they get their email once mail is set up.
      this.logger.warn('Anniversary emails skipped: no mail delivery is configured');
      return 0;
    }
    const due = await this.prisma.gift.findMany({
      where: {
        isPremium: true,
        status: 'PUBLISHED',
        publishedAt: { lte: addYears(now, -ANNIVERSARY_YEARS) },
        anniversaryEmailSentAt: null,
        customerEmail: { not: null },
      },
      orderBy: { publishedAt: 'asc' },
      take: BATCH,
    });

    let sent = 0;
    for (const gift of due) {
      if (!gift.customerEmail) continue;
      const claim = await this.prisma.gift.updateMany({
        where: { id: gift.id, anniversaryEmailSentAt: null },
        data: { anniversaryEmailSentAt: now },
      });
      // Another instance running the same job got there first.
      if (claim.count === 0) continue;
      try {
        await this.mailer.send({
          to: gift.customerEmail,
          idempotencyKey: `anniversary-${gift.id}`,
          ...anniversaryEmail({
            locale: LocaleSchema.catch('en').parse(gift.locale),
            recipientName: gift.recipientName,
            giftUrl: publicUrlOf(this.env.WEB_ORIGIN, gift.slug),
            createUrl: `${this.env.WEB_ORIGIN}/create`,
            brand: new URL(this.env.WEB_ORIGIN).host,
          }),
        });
        sent += 1;
      } catch (error) {
        await this.prisma.gift.updateMany({
          where: { id: gift.id },
          data: { anniversaryEmailSentAt: null },
        });
        this.logger.error(`Anniversary email of gift ${gift.id} failed: ${String(error)}`);
      }
    }
    return sent;
  }
}
