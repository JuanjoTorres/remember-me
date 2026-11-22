import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { GiftGrantService, GRANT_TTL_SECONDS } from './gift-grant.service.js';

const claims = {
  giftId: '3f0e6f0a-58a1-4d53-a4a9-3c2a0f6d2b11',
  slug: 'sarah-x9k2bd',
  plan: 'FREE' as const,
  published: false,
};

function service(secret = 'a'.repeat(32)) {
  return new GiftGrantService(loadEnv({ ...process.env, GRANT_SIGNING_SECRET: secret }));
}

describe('GiftGrantService', () => {
  it('round-trips the claims', () => {
    const grants = service();
    const { grant, expiresAt } = grants.issue(claims, new Date('2026-01-01T00:00:00Z'));
    expect(expiresAt.toISOString()).toBe('2026-01-01T00:30:00.000Z');
    expect(grants.verify(grant, new Date('2026-01-01T00:29:59Z'))).toMatchObject(claims);
  });

  it('rejects an expired grant', () => {
    const grants = service();
    const { grant } = grants.issue(claims, new Date('2026-01-01T00:00:00Z'));
    const expiry = new Date(Date.parse('2026-01-01T00:00:00Z') + GRANT_TTL_SECONDS * 1000);
    expect(() => grants.verify(grant, expiry)).toThrowError(/expired/);
  });

  it('rejects tampered claims, a foreign signature and garbage', () => {
    const grants = service();
    const { grant } = grants.issue(claims);
    const [, signature] = grant.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ ...claims, plan: 'PREMIUM', exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString('base64url');

    expect(() => grants.verify(`${forgedBody}.${signature}`)).toThrowError(/Invalid grant/);
    expect(() => grants.verify(service('b'.repeat(32)).issue(claims).grant)).toThrowError(
      /Invalid grant/,
    );
    for (const garbage of ['', 'abc', 'a.b.c', `${forgedBody}.`]) {
      expect(() => grants.verify(garbage)).toThrowError(/Invalid grant/);
    }
  });
});
