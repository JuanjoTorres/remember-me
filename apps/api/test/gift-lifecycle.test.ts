import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { GiftEditorView } from '@remember-me/shared-types';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GiftLifecycleService } from '../src/modules/gifts/gift-lifecycle.service.js';
import { ObjectStorage } from '../src/modules/media/object-storage.js';
import { PaymentSucceededEvent } from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { LogMailer } from '../src/shared/mail/log-mailer.js';
import { type MailMessage, Mailer } from '../src/shared/mail/mailer.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, photoCard } from './helpers.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A mail provider that keeps what it was asked to send. */
class RecordingMailer extends Mailer {
  readonly delivers = true;
  readonly sent: MailMessage[] = [];
  failNext = false;

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider is down'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

// A tiny valid PNG: enough for the media endpoint to store a real file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('gift lifecycle', () => {
  let app: INestApplication;
  const mailer = new RecordingMailer();
  const http = () => request(app.getHttpServer());
  const prisma = () => app.get(PrismaService);
  const lifecycle = () => app.get(GiftLifecycleService);
  const exists = async (giftId: string) =>
    (await prisma().gift.count({ where: { id: giftId } })) === 1;

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(Mailer).useValue(mailer));
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    mailer.sent.length = 0;
    mailer.failNext = false;
    vi.restoreAllMocks();
  });

  async function draft() {
    const { gift, editToken } = await createGift(app);
    const client = editor(app, gift.id, editToken);
    await client.addCard(photoCard()).expect(201);
    await client.update({ recipientName: 'Laura', reveal: { headline: 'Lisbon' } }).expect(200);
    return { gift, client };
  }

  async function publishedFree() {
    const { client } = await draft();
    const gift = (await client.publish().expect(200)).body as GiftEditorView;
    return { gift, client };
  }

  async function publishedPaid(customerEmail: string | null = 'buyer@example.com') {
    const { gift, client } = await draft();
    await app.get(EventBus).publish(PaymentSucceededEvent, {
      orderId: `order-${randomUUID()}`,
      giftId: gift.id,
      customSlug: null,
      customerEmail,
    });
    return { gift: (await client.get().expect(200)).body as GiftEditorView, client };
  }

  describe('expired gifts', () => {
    it('deletes an abandoned draft after its week, with its files, and frees its link', async () => {
      const { gift } = await draft();
      const uploaded = (
        await http()
          .post('/media/images')
          .set('Authorization', `Bearer ${gift.grant}`)
          .attach('file', PNG, 'photo.png')
          .expect(201)
      ).body.url as string;
      expect((await fetch(uploaded)).status).toBe(200);

      // Not yet: the week is not over.
      await lifecycle().deleteExpired(new Date(Date.now() + 6 * DAY_MS));
      expect(await exists(gift.id)).toBe(true);

      expect(await lifecycle().deleteExpired(new Date(Date.now() + 8 * DAY_MS))).toBeGreaterThan(0);
      expect(await exists(gift.id)).toBe(false);
      expect(await prisma().giftCard.count({ where: { giftId: gift.id } })).toBe(0);
      expect(await prisma().mediaAsset.count({ where: { giftId: gift.id } })).toBe(0);
      expect((await fetch(uploaded)).status).toBe(404);
      // Its link is free again: nothing holds it.
      expect(await prisma().gift.count({ where: { slug: gift.slug } })).toBe(0);
      expect(await prisma().giftSlugAlias.count({ where: { slug: gift.slug } })).toBe(0);
    });

    it('deletes a free gift three months after it was published, not before', async () => {
      const { gift } = await publishedFree();
      await lifecycle().deleteExpired(new Date(Date.now() + 88 * DAY_MS));
      expect(await exists(gift.id)).toBe(true);
      await http().get(`/public/gifts/${gift.slug}`).expect(200);

      await lifecycle().deleteExpired(new Date(Date.now() + 93 * DAY_MS));
      expect(await exists(gift.id)).toBe(false);
      await http().get(`/public/gifts/${gift.slug}`).expect(404);
    });

    it('never deletes a paid gift', async () => {
      const paid = await publishedPaid();
      const { gift: paidDraft } = await createGift(app);
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${randomUUID()}`,
        giftId: paidDraft.id,
        customSlug: null,
      });

      await lifecycle().deleteExpired(new Date(Date.now() + 20 * 366 * DAY_MS));
      expect(await exists(paid.gift.id)).toBe(true);
      expect(await exists(paidDraft.id)).toBe(true);
    });

    it('keeps a gift whose files could not be removed, and finishes on the next run', async () => {
      const { gift } = await draft();
      await http()
        .post('/media/images')
        .set('Authorization', `Bearer ${gift.grant}`)
        .attach('file', PNG, 'photo.png')
        .expect(201);
      const other = await draft();
      const afterAWeek = new Date(Date.now() + 8 * DAY_MS);

      vi.spyOn(app.get(ObjectStorage), 'delete').mockRejectedValue(new Error('storage is down'));
      await lifecycle().deleteExpired(afterAWeek);
      expect(await exists(gift.id)).toBe(true);
      // One gift failing does not hold back the others.
      expect(await exists(other.gift.id)).toBe(false);

      vi.restoreAllMocks();
      await lifecycle().deleteExpired(afterAWeek);
      expect(await exists(gift.id)).toBe(false);
      expect(await prisma().mediaAsset.count({ where: { giftId: gift.id } })).toBe(0);
    });
  });

  describe('anniversary email', () => {
    const publishedYearsAgo = (giftId: string, days: number) =>
      prisma().gift.update({
        where: { id: giftId },
        data: { publishedAt: new Date(Date.now() - days * DAY_MS) },
      });
    const mailsTo = (address: string) => mailer.sent.filter((mail) => mail.to === address);

    it('invites the buyer of a paid gift once, a year after it was published', async () => {
      const address = `${randomUUID()}@example.com`;
      const { gift } = await publishedPaid(address);

      await publishedYearsAgo(gift.id, 364);
      await lifecycle().sendAnniversaryEmails();
      expect(mailsTo(address)).toEqual([]);

      await publishedYearsAgo(gift.id, 366);
      await lifecycle().sendAnniversaryEmails();
      const [mail] = mailsTo(address);
      expect(mailsTo(address)).toHaveLength(1);
      // The gift is in Spanish (the test helper creates it so), and so is its email.
      expect(mail!.subject).toBe('Hace un año sorprendiste a Laura');
      for (const body of [mail!.html, mail!.text]) {
        expect(body).toContain(`http://localhost:3000/${gift.slug}`);
        expect(body).toContain('http://localhost:3000/create');
        expect(body).toContain('Crear un regalo nuevo');
      }
      expect(mail!.idempotencyKey).toBe(`anniversary-${gift.id}`);
      expect(
        (await prisma().gift.findUniqueOrThrow({ where: { id: gift.id } })).anniversaryEmailSentAt,
      ).not.toBeNull();

      // Every later run leaves the buyer alone.
      await lifecycle().sendAnniversaryEmails();
      await lifecycle().sendAnniversaryEmails(new Date(Date.now() + 400 * DAY_MS));
      expect(mailsTo(address)).toHaveLength(1);
    });

    it('sends one email when two instances run the job at the same time', async () => {
      const address = `${randomUUID()}@example.com`;
      const { gift } = await publishedPaid(address);
      await publishedYearsAgo(gift.id, 366);
      await Promise.all([lifecycle().sendAnniversaryEmails(), lifecycle().sendAnniversaryEmails()]);
      expect(mailsTo(address)).toHaveLength(1);
    });

    it('does not write to a free gift, nor to a buyer without an address', async () => {
      const free = await publishedFree();
      const noAddress = await publishedPaid(null);
      await publishedYearsAgo(free.gift.id, 366);
      await publishedYearsAgo(noAddress.gift.id, 366);
      // The free gift would be deleted by now; here only the email job is under test.
      await prisma().gift.update({
        where: { id: free.gift.id },
        data: { customerEmail: 'someone@example.com' },
      });

      await lifecycle().sendAnniversaryEmails();
      expect(mailsTo('someone@example.com')).toEqual([]);
      for (const giftId of [free.gift.id, noAddress.gift.id]) {
        expect(
          (await prisma().gift.findUniqueOrThrow({ where: { id: giftId } })).anniversaryEmailSentAt,
        ).toBeNull();
      }
    });

    it('tries again on the next run when the email could not be sent', async () => {
      const address = `${randomUUID()}@example.com`;
      const { gift } = await publishedPaid(address);
      // Older than any other gift of this file, so it is the first one the job picks.
      await publishedYearsAgo(gift.id, 5000);

      mailer.failNext = true;
      await lifecycle().sendAnniversaryEmails();
      expect(mailsTo(address)).toEqual([]);
      expect(
        (await prisma().gift.findUniqueOrThrow({ where: { id: gift.id } })).anniversaryEmailSentAt,
      ).toBeNull();

      await lifecycle().sendAnniversaryEmails();
      expect(mailsTo(address)).toHaveLength(1);
    });

    it('escapes the name the creator typed', async () => {
      const address = `${randomUUID()}@example.com`;
      const { gift } = await publishedPaid(address);
      await prisma().gift.update({
        where: { id: gift.id },
        data: {
          recipientName: '<b>Ana</b> & "Luis"',
          locale: 'en',
          publishedAt: new Date(Date.now() - 366 * DAY_MS),
        },
      });
      await lifecycle().sendAnniversaryEmails();
      const [mail] = mailsTo(address);
      expect(mail!.subject).toBe('One year ago you surprised <b>Ana</b> & "Luis"');
      expect(mail!.html).not.toContain('<b>Ana</b>');
      expect(mail!.html).toContain('&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Luis&quot;');
      expect(mail!.html).toContain('Create a new gift');
    });
  });

  describe('without mail delivery', () => {
    it('sends nothing and leaves the gifts waiting for when mail is set up', async () => {
      const silent = await createTestApp((builder) =>
        builder.overrideProvider(Mailer).useValue(new LogMailer()),
      );
      try {
        const address = `${randomUUID()}@example.com`;
        const { gift } = await publishedPaid(address);
        await prisma().gift.update({
          where: { id: gift.id },
          data: { publishedAt: new Date(Date.now() - 366 * DAY_MS) },
        });
        expect(await silent.get(GiftLifecycleService).sendAnniversaryEmails()).toBe(0);
        expect(
          (await prisma().gift.findUniqueOrThrow({ where: { id: gift.id } }))
            .anniversaryEmailSentAt,
        ).toBeNull();

        await lifecycle().sendAnniversaryEmails();
        expect(mailer.sent.filter((mail) => mail.to === address)).toHaveLength(1);
      } finally {
        await silent.close();
      }
    });
  });
});
