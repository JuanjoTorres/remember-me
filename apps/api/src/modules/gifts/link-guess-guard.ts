import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/http/app-error.js';
import { AttemptLimiter } from '../../shared/http/attempt-limiter.js';

/** Both budgets are counted over this long. */
export const LINK_GUESS_WINDOW_MS = 10 * 60 * 1000;

/**
 * A gift has no password: whoever has its link can open it. This keeps a link from being found by
 * trying addresses. A recipient opens links that exist, so only wrong ones count; someone working
 * through combinations runs out of attempts after a handful and is refused for the rest of the
 * window, whatever they ask for.
 */
@Injectable()
export class LinkGuessGuard {
  /** Links opened that led to no gift. */
  private readonly misses: AttemptLimiter;
  /** Availability checks: each one tells whether a link exists, so every check counts. */
  private readonly checks: AttemptLimiter;

  constructor(@Inject(ENV) env: Env) {
    this.misses = new AttemptLimiter(env.LINK_LOOKUP_MISS_LIMIT, LINK_GUESS_WINDOW_MS);
    this.checks = new AttemptLimiter(env.SLUG_CHECK_LIMIT, LINK_GUESS_WINDOW_MS);
  }

  /** Refuses a client that has opened too many links that do not exist. */
  assertMayOpen(address: string): void {
    const client = clientOf(address);
    if (this.misses.isBlocked(client)) throw tooMany(this.misses.retryAfterSeconds(client));
  }

  /** A link the client opened led to no gift. */
  missed(address: string): void {
    this.misses.record(clientOf(address));
  }

  /** Counts an availability check, and refuses it once the client has made too many. */
  countCheck(address: string): void {
    const client = clientOf(address);
    if (this.checks.isBlocked(client)) throw tooMany(this.checks.retryAfterSeconds(client));
    this.checks.record(client);
  }
}

/**
 * Who an address counts as. An IPv4 address is one client. An IPv6 subscriber is handed a whole
 * network (a /64) and can change address within it at will, so the network is the client.
 */
export function clientOf(address: string): string {
  // IPv4, also when written inside IPv6 ("::ffff:203.0.113.7").
  if (address.includes('.') || !address.includes(':')) return address;
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const leading = head === '' ? [] : head.split(':');
  const trailing = tail === '' ? [] : tail.split(':');
  const zeros = address.includes('::') ? Math.max(0, 8 - leading.length - trailing.length) : 0;
  const groups = [...leading, ...Array<string>(zeros).fill('0'), ...trailing];
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}

function tooMany(retryAfterSeconds: number): AppError {
  return new AppError('RATE_LIMITED', 'Too many attempts. Try again later.', { retryAfterSeconds });
}
