import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  WEB_ORIGIN: 'http://localhost:3000/',
  GRANT_SIGNING_SECRET: 'x'.repeat(32),
  MEDIA_PUBLIC_URL: 'http://localhost:9000/media/',
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

  it('rejects a short signing secret', () => {
    expect(() => loadEnv({ ...valid, GRANT_SIGNING_SECRET: 'short' })).toThrowError(
      /GRANT_SIGNING_SECRET/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'prod' })).toThrowError(/NODE_ENV/);
  });
});
