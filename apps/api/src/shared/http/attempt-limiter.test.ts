import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from './attempt-limiter.js';

const MINUTE = 60_000;

describe('AttemptLimiter', () => {
  it('blocks a client once it has used its attempts, and only that client', () => {
    const limiter = new AttemptLimiter(3, 10 * MINUTE);
    for (let i = 0; i < 2; i += 1) limiter.record('a', 0);
    expect(limiter.isBlocked('a', 0)).toBe(false);
    limiter.record('a', 0);
    expect(limiter.isBlocked('a', 0)).toBe(true);
    expect(limiter.isBlocked('b', 0)).toBe(false);
  });

  it('counts the window from the first attempt and lets the client back in when it ends', () => {
    const limiter = new AttemptLimiter(2, 10 * MINUTE);
    limiter.record('a', 0);
    limiter.record('a', 9 * MINUTE);
    expect(limiter.isBlocked('a', 9 * MINUTE)).toBe(true);
    expect(limiter.retryAfterSeconds('a', 9 * MINUTE)).toBe(60);
    // A later attempt does not push the end of the window further away.
    expect(limiter.isBlocked('a', 10 * MINUTE)).toBe(false);
    expect(limiter.retryAfterSeconds('a', 10 * MINUTE)).toBe(0);
    limiter.record('a', 10 * MINUTE);
    expect(limiter.isBlocked('a', 10 * MINUTE)).toBe(false);
  });

  it('does not grow without limit when attempts come from very many addresses', () => {
    const limiter = new AttemptLimiter(1, MINUTE);
    for (let i = 0; i < 50_001; i += 1) limiter.record(`client-${i}`, 0);
    // Reaching the ceiling cleared the table: early clients were forgotten, the newest is known.
    expect(limiter.isBlocked('client-0', 0)).toBe(false);
    expect(limiter.isBlocked('client-50000', 0)).toBe(true);
  });

  it('keeps a blocked client blocked when a flood of other addresses fills the table', () => {
    const limiter = new AttemptLimiter(3, 10 * MINUTE);
    for (let i = 0; i < 3; i += 1) limiter.record('guesser', 0);
    limiter.record('visitor', 0);
    for (let i = 0; i < 50_001; i += 1) limiter.record(`flood-${i}`, 0);
    expect(limiter.isBlocked('guesser', 0)).toBe(true);
    // A client that was merely counted loses its count, which only makes the limit more lenient.
    limiter.record('visitor', 0);
    limiter.record('visitor', 0);
    expect(limiter.isBlocked('visitor', 0)).toBe(false);
  });
});
