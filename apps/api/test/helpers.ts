import type { INestApplication } from '@nestjs/common';
import type { CardInput, CreateGiftResponse } from '@remember-me/shared-types';
import request from 'supertest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

export function mediaUrl(giftId: string, fileName: string): string {
  return `${process.env['MEDIA_PUBLIC_URL']}/gifts/${giftId}/${fileName}`;
}

export function photoCard(text = 'Remember this?'): CardInput {
  return { type: 'PHOTO_TEXT', payload: { text, imageUrl: null } };
}

export async function createGift(app: INestApplication): Promise<CreateGiftResponse> {
  const response = await request(app.getHttpServer())
    .post('/gifts')
    .send({ locale: 'es' })
    .expect(201);
  return response.body as CreateGiftResponse;
}

/** Marks a gift as paid directly in the database, for tests that are not about the payment flow. */
export async function makePremium(app: INestApplication, giftId: string): Promise<void> {
  await app.get(PrismaService).gift.update({ where: { id: giftId }, data: { isPremium: true } });
}

/**
 * A client bound to one gift and its edit token. With `session`, it sends back the grant of an
 * earlier answer, as the editor in the browser does.
 */
export function editor(
  app: INestApplication,
  giftId: string,
  editToken: string,
  session?: () => string,
) {
  const send = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
  ) => {
    const agent = request(app.getHttpServer());
    const call = agent[method](`/gifts/${giftId}${path}`).set('x-edit-token', editToken);
    if (session) void call.set('x-edit-session', session());
    return body ? call.send(body) : call;
  };
  return {
    get: () => send('get', ''),
    update: (body: object) => send('patch', '', body),
    remove: () => send('delete', ''),
    publish: () => send('post', '/publish'),
    changeSlug: (slug: string) => send('put', '/slug', { slug }),
    addCard: (card: object) => send('post', '/cards', card),
    updateCard: (cardId: string, card: object) => send('patch', `/cards/${cardId}`, card),
    removeCard: (cardId: string) => send('delete', `/cards/${cardId}`),
    reorder: (cardIds: string[]) => send('put', '/cards/order', { cardIds }),
  };
}
