/** Clients remembered at most; past that the oldest windows are dropped. */
const MAX_CLIENTS = 50_000;

/**
 * Counts what one client does within a window of time and says when it has done too much. In
 * memory and per process, like the request throttler: enough to make guessing slow, not a ledger.
 */
export class AttemptLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Whether the client has used up its attempts for the current window. */
  isBlocked(client: string, now = Date.now()): boolean {
    const window = this.current(client, now);
    return window !== undefined && window.count >= this.limit;
  }

  /** Records one attempt. */
  record(client: string, now = Date.now()): void {
    const window = this.current(client, now);
    if (window) {
      window.count += 1;
      return;
    }
    if (this.windows.size >= MAX_CLIENTS) this.forgetExpired(now);
    this.windows.set(client, { count: 1, resetAt: now + this.windowMs });
  }

  /** Seconds until the client may try again. */
  retryAfterSeconds(client: string, now = Date.now()): number {
    const window = this.current(client, now);
    return window ? Math.max(1, Math.ceil((window.resetAt - now) / 1000)) : 0;
  }

  private current(client: string, now: number) {
    const window = this.windows.get(client);
    if (window && window.resetAt <= now) {
      this.windows.delete(client);
      return undefined;
    }
    return window;
  }

  private forgetExpired(now: number): void {
    for (const [client, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(client);
    }
    if (this.windows.size < MAX_CLIENTS) return;
    // Still full of live windows (a flood from many addresses). Clients that are not blocked lose
    // their count; the blocked ones stay blocked, or a flood would be a way to lift a block.
    for (const [client, window] of this.windows) {
      if (window.count < this.limit) this.windows.delete(client);
    }
    if (this.windows.size >= MAX_CLIENTS) this.windows.clear();
  }
}
