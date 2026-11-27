import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './create-test-app.js';

describe('rate limits', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env['RATE_LIMIT_PER_MINUTE'] = '12';
    process.env['GIFT_CREATION_LIMIT_PER_HOUR'] = '3';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('limits how many gifts one client can start, without blocking the rest of the API', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await request(app.getHttpServer()).post('/gifts').send({})).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    // Spelling the path differently does not get around the limit.
    for (const path of ['/gifts/', '/GIFTS', '/Gifts/']) {
      expect((await request(app.getHttpServer()).post(path).send({})).status, path).toBe(429);
    }

    const refused = await request(app.getHttpServer()).post('/gifts').send({});
    expect(refused.body.code).toBe('RATE_LIMITED');
    expect(refused.headers['retry-after-gift-creation']).toBeDefined();
    // The rest of the API still answers this client: no gift behind this link, but no refusal.
    await request(app.getHttpServer()).get('/public/gifts/x9k2bd7m').expect(404);
  });

  it('applies the general limit per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      statuses.push((await request(app.getHttpServer()).get('/public/gifts/nobody-home')).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 404).length).toBeLessThanOrEqual(12);
  });

  it('never limits the health check or the Stripe webhook', async () => {
    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer()).get('/health').expect(200);
      // Unsigned, so it is rejected for its signature, not for the rate.
      await request(app.getHttpServer()).post('/payments/webhook').send({}).expect(401);
    }
  });

  it('sends hardening headers', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
