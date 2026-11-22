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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { createTestApp } from './create-test-app.js';
import { createGift, editor, makePremium, photoCard } from './helpers.js';

// jsqr is CommonJS with a `default` export; its typings and Node's ESM interop disagree.
const jsQR = ((jsqrModule as unknown as { default?: typeof jsqrModule }).default ??
  jsqrModule) as unknown as typeof import('jsqr').default;

const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x1c]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(64),
]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);

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
    it('asks a free gift for premium', async () => {
      const { grant } = await setup();
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
      await upload(grant, 'audio', Buffer.from('RIFF....WAVEfmt '), 'voice.mp3').expect(415);
    });
  });

  describe('gift deletion', () => {
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
        text: `http://localhost:3000/for/${gift.slug}`,
        width: 512,
      });
      expect(gift.publicUrl).toBe(`http://localhost:3000/for/${gift.slug}`);
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

    it('refuses drafts, unknown formats and missing grants', async () => {
      const draft = await setup();
      expect((await qr(draft.grant).expect(409)).body.code).toBe('CONFLICT');
      const published = await setup({ published: true });
      await qr(published.grant, 'gif').expect(400);
      await http().get('/qr').expect(401);
    });
  });
});
