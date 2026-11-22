import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  WEB_ORIGIN: 'http://localhost:3000/',
  GRANT_SIGNING_SECRET: 'x'.repeat(32),
  MEDIA_PUBLIC_URL: 'http://localhost:9000/media/',
  S3_ENDPOINT: 'http://localhost:9090',
  S3_BUCKET: 'remember-me',
  S3_ACCESS_KEY_ID: 'local',
  S3_SECRET_ACCESS_KEY: 'local',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_PRICE_ID_PREMIUM: 'price_premium',
  STRIPE_PRICE_ID_CUSTOM_SLUG: 'price_slug',
};

describe('loadEnv', () => {
  it('applies defaults and normalizes the web origin', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.EVENT_BUS_DRIVER).toBe('memory');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
  });

  it('rejects a missing database url and names the variable', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: undefined })).toThrowError(/DATABASE_URL/);
  });

  it('rejects a non-postgres database url', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrowError(
      InvalidEnvError,
    );
  });

  it('requires REDIS_URL for the redis event bus', () => {
    expect(() => loadEnv({ ...valid, EVENT_BUS_DRIVER: 'redis' })).toThrowError(/REDIS_URL/);
    expect(
      loadEnv({ ...valid, EVENT_BUS_DRIVER: 'redis', REDIS_URL: 'redis://localhost:6379' })
        .EVENT_BUS_DRIVER,
    ).toBe('redis');
  });

  it('reads the storage settings', () => {
    expect(loadEnv(valid)).toMatchObject({ S3_REGION: 'auto', S3_FORCE_PATH_STYLE: true });
    expect(loadEnv({ ...valid, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(() => loadEnv({ ...valid, S3_BUCKET: undefined })).toThrowError(/S3_BUCKET/);
  });

  it('validates the Stripe settings', () => {
    expect(() => loadEnv({ ...valid, STRIPE_SECRET_KEY: 'pk_test_123' })).toThrowError(
      /STRIPE_SECRET_KEY/,
    );
    expect(() => loadEnv({ ...valid, STRIPE_PRICE_ID_PREMIUM: 'prod_123' })).toThrowError(
      /STRIPE_PRICE_ID_PREMIUM/,
    );
    expect(() => loadEnv({ ...valid, STRIPE_PRICE_ID_CUSTOM_SLUG: undefined })).toThrowError(
      /STRIPE_PRICE_ID_CUSTOM_SLUG/,
    );
    expect(() =>
      loadEnv({ ...valid, NODE_ENV: 'production', GRANT_SIGNING_SECRET: 'x'.repeat(32) }),
    ).toThrowError(/live Stripe key/);
  });

  it('rejects a short signing secret', () => {
    expect(() => loadEnv({ ...valid, GRANT_SIGNING_SECRET: 'short' })).toThrowError(
      /GRANT_SIGNING_SECRET/,
    );
  });

  it('refuses the example signing secret outside development', () => {
    const example = 'change-me-change-me-change-me-change-me';
    expect(loadEnv({ ...valid, GRANT_SIGNING_SECRET: example }).NODE_ENV).toBe('development');
    for (const NODE_ENV of ['staging', 'production']) {
      expect(() => loadEnv({ ...valid, NODE_ENV, GRANT_SIGNING_SECRET: example })).toThrowError(
        /example value/,
      );
    }
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'prod' })).toThrowError(/NODE_ENV/);
  });
});
