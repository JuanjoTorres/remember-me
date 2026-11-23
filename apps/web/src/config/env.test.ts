import { describe, expect, it } from 'vitest';
import { parseClientEnv, parseServerEnv } from './env';

describe('web env', () => {
  it('accepts valid urls and strips the trailing slash', () => {
    expect(parseClientEnv({ NEXT_PUBLIC_API_URL: 'https://api.remember.me/' })).toEqual({
      NEXT_PUBLIC_API_URL: 'https://api.remember.me',
    });
    expect(parseServerEnv({ INTERNAL_API_URL: 'http://api:4000' }).INTERNAL_API_URL).toBe(
      'http://api:4000',
    );
  });

  it('names the missing public variable', () => {
    expect(() => parseClientEnv({})).toThrowError(/NEXT_PUBLIC_API_URL/);
  });

  it('rejects a non-http internal url', () => {
    expect(() => parseServerEnv({ INTERNAL_API_URL: 'ftp://api' })).toThrowError(
      /INTERNAL_API_URL/,
    );
  });
});
