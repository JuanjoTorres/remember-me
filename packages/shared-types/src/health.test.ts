import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts a healthy response', () => {
    expect(HealthResponseSchema.parse({ status: 'ok', database: 'up' })).toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('rejects an unknown database state', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', database: 'maybe' }).success).toBe(false);
  });
});
