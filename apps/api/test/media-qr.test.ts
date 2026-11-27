import type { INestApplication } from '@nestjs/common';
import {
  type GiftEditorView,
  MEDIA_LIMITS,
  MediaUploadResponseSchema,
} from '@remember-me/shared-types';
import jsqrModule from 'jsqr';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_ASSETS_PER_GIFT } from '../src/modules/media/media.service.js';
import { ObjectStorage } from '../src/modules/media/object-storage.js';
import { PaymentSucceededEvent } from '../src/shared/events/contracts.js';
import { EventBus } from '../src/shared/events/event-bus.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, customLinkOf, editor, freeName, makePremium, photoCard } from './helpers.js';

// jsqr is CommonJS with a `default` export; its typings and Node's ESM interop disagree.
const jsQR = ((jsqrModule as unknown as { default?: typeof jsqrModule }).default ??
  jsqrModule) as unknown as typeof import('jsqr').default;

/** Two consecutive 128 kbps / 44.1 kHz MPEG-1 Layer III frames (417 bytes each), silent. */
const MP3_FRAMES = Buffer.concat(
  [0, 1].map(() => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])),
);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0]), MP3_FRAMES]);

function box(type: string, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 8);
  return Buffer.concat([size, Buffer.from(type, 'latin1'), body]);
}

/** Minimal ISO media file with one track of the given handler type. */
function mp4(brand: string, handler: 'soun' | 'vide'): Buffer {
  const hdlr = box('hdlr', Buffer.alloc(8), Buffer.from(handler), Buffer.alloc(12));
  return Buffer.concat([
    box('ftyp', Buffer.from(brand), Buffer.alloc(4), Buffer.from('isom')),
    box('moov', box('trak', box('mdia', hdlr))),
  ]);
}
const M4A = mp4('M4A ', 'soun');

function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#e8553d' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-location-metadata' } })
    .toBuffer();
}

describe('media and qr', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const upload = (grant: string, kind: 'images' | 'audio', file: Buffer, name = 'file.bin') =>
    http()
      .post(`/media/${kind}`)
      .set('Authorization', `Bearer ${grant}`)
      .attach('file', file, name);

  /** A gift plus a client that always sends a fresh grant. */
  async function setup(options: { premium?: boolean; published?: boolean } = {}) {
    const { gift, editToken } = await createGift(app);
    const client = editor(app, gift.id, editToken);
    if (options.premium) await makePremium(app, gift.id);
    if (options.published) {
      await client.addCard(photoCard()).expect(201);
      await client.update({ recipientName: 'Sarah', reveal: { headline: 'Lisbon' } }).expect(200);
      await client.publish().expect(200);
    }
    const view = (await client.get().expect(200)).body as GiftEditorView;
    return { client, gift: view, grant: view.grant };
  }

  describe('image upload', () => {
    it('stores a JPEG as a resized WebP without metadata and serves it publicly', async () => {
      const { gift, grant, client } = await setup();
      const response = await upload(grant, 'images', await jpeg(3000, 2000), 'photo.jpg').expect(
        201,
      );
      const uploaded = MediaUploadResponseSchema.parse(response.body);
      expect(uploaded).toMatchObject({ kind: 'IMAGE', contentType: 'image/webp' });
      expect(uploaded.url).toMatch(new RegExp(`/gifts/${gift.id}/[0-9a-f-]+\\.webp$`));

      const stored = await fetch(uploaded.url);
      expect(stored.status).toBe(200);
      const body = Buffer.from(await stored.arrayBuffer());
      const metadata = await sharp(body).metadata();
      expect(metadata).toMatchObject({
        format: 'webp',
        width: MEDIA_LIMITS.imageMaxEdge,
        height: 1067,
      });
      expect(metadata.exif).toBeUndefined();
      expect(body.includes('secret-location-metadata')).toBe(false);

      // The returned URL is accepted by the gifts module for a card of the same gift.
      await client.addCard({ type: 'PHOTO_TEXT', payload: { imageUrl: uploaded.url } }).expect(201);
    });

    it('does not enlarge small images', async () => {
      const { grant } = await setup();
      const { url } = (await upload(grant, 'images', await jpeg(400, 300)).expect(201)).body;
      const metadata = await sharp(Buffer.from(await (await fetch(url)).arrayBuffer())).metadata();
      expect(metadata).toMatchObject({ width: 400, height: 300 });
    });

    it('rejects files that are not images, whatever their name', async () => {
      const { grant } = await setup();
      const response = await upload(
        grant,
        'images',
        Buffer.from('<svg onload=alert(1)>'),
        'photo.jpg',
      ).expect(415);
      expect(response.body.code).toBe('UNSUPPORTED_MEDIA');
      await upload(grant, 'images', MP3, 'photo.png').expect(415);
    });

    it('rejects an oversized upload', async () => {
      const { grant } = await setup();
      const response = await upload(
        grant,
        'images',
        Buffer.alloc(MEDIA_LIMITS.imageMaxBytes + 1),
      ).expect(413);
      expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('requires a file and a valid grant', async () => {
      const { grant } = await setup();
      await http().post('/media/images').set('Authorization', `Bearer ${grant}`).expect(400);
      await http()
        .post('/media/images')
        .attach('file', await jpeg(10, 10), 'a.jpg')
        .expect(401);
      await upload(`${grant}x`, 'images', await jpeg(10, 10)).expect(401);
    });
  });

  describe('audio upload', () => {
    it('lets a draft record a voice note before anything is paid', async () => {
      const { grant, client } = await setup();
      const uploaded = (await upload(grant, 'audio', M4A, 'voice.m4a').expect(201)).body;
      await client.addCard({ type: 'AUDIO_NOTE', payload: { audioUrl: uploaded.url } }).expect(201);
    });

    it('asks a published free gift for premium', async () => {
      const { grant } = await setup({ published: true });
      const response = await upload(grant, 'audio', M4A, 'voice.m4a').expect(402);
      expect(response.body).toMatchObject({
        code: 'PREMIUM_REQUIRED',
        details: { capability: 'AUDIO_UPLOAD' },
      });
    });

    it('stores M4A and MP3 for a premium gift', async () => {
      const { grant, client } = await setup({ premium: true });
      const m4a = (await upload(grant, 'audio', M4A, 'voice.m4a').expect(201)).body;
      const mp3 = (await upload(grant, 'audio', MP3, 'voice.mp3').expect(201)).body;
      expect(m4a).toMatchObject({ kind: 'AUDIO', contentType: 'audio/mp4' });
      expect(m4a.url).toMatch(/\.m4a$/);
      expect(mp3).toMatchObject({ contentType: 'audio/mpeg' });
      expect(Buffer.from(await (await fetch(mp3.url)).arrayBuffer()).equals(MP3)).toBe(true);
      await client.addCard({ type: 'AUDIO_NOTE', payload: { audioUrl: m4a.url } }).expect(201);
    });

    it('rejects other content even when it is named like audio', async () => {
      const { grant } = await setup({ premium: true });
      const rejected: [string, Buffer][] = [
        ['a WAV file', Buffer.from('RIFF....WAVEfmt ')],
        [
          'an ID3 tag with no audio after it',
          Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]),
        ],
        [
          'text with a UTF-16 byte order mark',
          Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.alloc(900)]),
        ],
        [
          'a single stray frame header',
          Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(900)]),
        ],
        ['an MP4 video', mp4('mp42', 'vide')],
        ['a HEIC image', mp4('heic', 'soun')],
        ['an MP4 without tracks', box('ftyp', Buffer.from('M4A '), Buffer.alloc(8))],
      ];
      for (const [what, file] of rejected) {
        const response = await upload(grant, 'audio', file, 'voice.mp3');
        expect(response.status, what).toBe(415);
      }
      // A bare MP3 stream without an ID3 tag is fine.
      await upload(grant, 'audio', MP3_FRAMES, 'voice.mp3').expect(201);
    });
  });

  describe('storage ceiling', () => {
    it('holds under parallel uploads', async () => {
      const { gift, grant } = await setup();
      const prisma = app.get(PrismaService);
      await prisma.mediaAsset.createMany({
        data: Array.from({ length: MAX_ASSETS_PER_GIFT - 2 }, (_, i) => ({
          giftId: gift.id,
          kind: 'IMAGE' as const,
          storageKey: `gifts/${gift.id}/filler-${i}.webp`,
          contentType: 'image/webp',
          bytes: 1,
        })),
      });
      const image = await jpeg(20, 20);
      const statuses = (
        await Promise.all(Array.from({ length: 5 }, () => upload(grant, 'images', image)))
      ).map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(2);
      expect(statuses.filter((status) => status === 409)).toHaveLength(3);
      expect(await prisma.mediaAsset.count({ where: { giftId: gift.id } })).toBe(
        MAX_ASSETS_PER_GIFT,
      );
    });

    it('does not keep a record of a file that could not be stored', async () => {
      const { gift, grant } = await setup();
      const storage = app.get(ObjectStorage);
      const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('storage is down'));
      await upload(grant, 'images', await jpeg(20, 20)).expect(500);
      put.mockRestore();
      expect(await app.get(PrismaService).mediaAsset.count({ where: { giftId: gift.id } })).toBe(0);
    });
  });

  describe('gift deletion', () => {
    it('keeps the gift when its files cannot be removed, so that deleting can be retried', async () => {
      const { gift, grant, client } = await setup();
      const first = (await upload(grant, 'images', await jpeg(50, 50)).expect(201)).body
        .url as string;
      const second = (await upload(grant, 'images', await jpeg(60, 60)).expect(201)).body
        .url as string;

      const storage = app.get(ObjectStorage);
      const realDelete = storage.delete.bind(storage);
      let calls = 0;
      const remove = vi.spyOn(storage, 'delete').mockImplementation(async (keys) => {
        calls += 1;
        if (calls === 2) throw new Error('storage is down');
        return realDelete(keys);
      });

      await client.remove().expect(500);
      await client.get().expect(200);
      expect(await app.get(PrismaService).mediaAsset.count({ where: { giftId: gift.id } })).toBe(1);

      remove.mockRestore();
      await client.remove().expect(204);
      for (const url of [first, second]) expect((await fetch(url)).status).toBe(404);
      expect(await app.get(PrismaService).mediaAsset.count({ where: { giftId: gift.id } })).toBe(0);
    });

    it('removes the stored files of the gift', async () => {
      const { gift, grant, client } = await setup();
      const { url } = (await upload(grant, 'images', await jpeg(50, 50)).expect(201)).body;
      expect((await fetch(url)).status).toBe(200);

      await client.remove().expect(204);
      expect((await fetch(url)).status).toBe(404);
      expect(await app.get(PrismaService).mediaAsset.count({ where: { giftId: gift.id } })).toBe(0);
    });
  });

  describe('qr', () => {
    const qr = (grant: string, format?: string) =>
      http()
        .get('/qr')
        .query(format ? { format } : {})
        .set('Authorization', `Bearer ${grant}`);

    async function decodePng(
      response: request.Response,
    ): Promise<{ text: string | undefined; width: number }> {
      const png = PNG.sync.read(response.body as Buffer);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      return { text: decoded?.data, width: png.width };
    }

    it('gives a free published gift a PNG that decodes to its public link', async () => {
      const { gift, grant } = await setup({ published: true });
      const response = await qr(grant)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-disposition']).toContain(`remember-me-${gift.slug}.png`);
      expect(await decodePng(response)).toEqual({
        text: `http://localhost:3000/${gift.slug}`,
        width: 512,
      });
      expect(gift.publicUrl).toBe(`http://localhost:3000/${gift.slug}`);
    });

    it('keeps SVG for premium gifts', async () => {
      const free = await setup({ published: true });
      const refused = await qr(free.grant, 'svg').expect(402);
      expect(refused.body).toMatchObject({
        code: 'PREMIUM_REQUIRED',
        details: { capability: 'QR_FORMAT' },
      });

      const premium = await setup({ published: true, premium: true });
      const svg = await qr(premium.grant, 'svg')
        .buffer(true)
        .parse((res, done) => {
          let text = '';
          res.on('data', (chunk: Buffer) => (text += chunk.toString()));
          res.on('end', () => done(null, text));
        });
      expect(svg.status).toBe(200);
      expect(svg.headers['content-type']).toBe('image/svg+xml');
      expect(String(svg.body)).toMatch(/^<svg/);
    });

    it('gives premium gifts a high resolution PNG', async () => {
      const { grant } = await setup({ published: true, premium: true });
      const response = await qr(grant, 'png')
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect((await decodePng(response)).width).toBe(2048);
    });

    it('never encodes a dead link: a link replaced after publication keeps working', async () => {
      const { gift, grant, client } = await setup({ published: true });
      const name = freeName('para-sarah');
      await app.get(EventBus).publish(PaymentSucceededEvent, {
        orderId: `order-${gift.id}`,
        giftId: gift.id,
        customSlug: name,
      });
      const custom = ((await client.get()).body as GiftEditorView).slug;
      expect(custom).toMatch(customLinkOf(name));

      // A grant issued before the payment still names the old link.
      const response = await qr(grant)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      const { text } = await decodePng(response);
      expect(text).toBe(`http://localhost:3000/${gift.slug}`);
      for (const slug of [gift.slug, custom]) {
        expect((await http().get(`/public/gifts/${slug}`).expect(200)).body.slug).toBe(custom);
      }
      // The old link stays reserved for this gift: no new gift is ever given it.
      expect(
        await app.get(PrismaService).giftSlugAlias.findUnique({ where: { slug: gift.slug } }),
      ).toMatchObject({ giftId: gift.id });
    });

    it('refuses drafts, unknown formats and missing grants', async () => {
      const draft = await setup();
      expect((await qr(draft.grant).expect(409)).body.code).toBe('CONFLICT');
      const published = await setup({ published: true });
      await qr(published.grant, 'gif').expect(400);
      await http().get('/qr').expect(401);
    });
  });
});
