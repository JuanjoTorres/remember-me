import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EventBus, type EventDefinition, type EventHandler } from './event-bus.js';

export interface RedisEventBusOptions {
  /** How long a delivered but unacknowledged event waits before it is retried. */
  retryAfterMs?: number;
  /** How long one blocking read waits for new events. */
  blockMs?: number;
}

type StreamEntry = [id: string, fields: string[]];

/**
 * Redis Streams driver, used with `EVENT_BUS_DRIVER=redis`. Each subscriber is a consumer group, so
 * every subscriber sees every event and several instances of the same module share the work.
 * An event is acknowledged only after its handler succeeds; otherwise it is claimed again later.
 */
export class RedisEventBus extends EventBus {
  private readonly logger = new Logger('RedisEventBus');
  private readonly publisher: Redis;
  private readonly readers: Redis[] = [];
  private readonly consumer = randomUUID();
  private readonly retryAfterMs: number;
  private readonly blockMs: number;
  private closed = false;

  constructor(
    private readonly url: string,
    options: RedisEventBusOptions = {},
  ) {
    super();
    this.publisher = new Redis(url);
    this.retryAfterMs = options.retryAfterMs ?? 30_000;
    this.blockMs = options.blockMs ?? 2_000;
  }

  async publish<TPayload>(event: EventDefinition<TPayload>, payload: TPayload): Promise<void> {
    const body = JSON.stringify(event.schema.parse(payload));
    await this.publisher.xadd(streamOf(event), '*', 'payload', body);
  }

  subscribe<TPayload>(
    event: EventDefinition<TPayload>,
    subscriber: string,
    handler: EventHandler<TPayload>,
  ): void {
    const reader = new Redis(this.url);
    this.readers.push(reader);
    void this.consume(reader, event, subscriber, handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const connection of [this.publisher, ...this.readers]) connection.disconnect();
  }

  private async consume<TPayload>(
    reader: Redis,
    event: EventDefinition<TPayload>,
    group: string,
    handler: EventHandler<TPayload>,
  ): Promise<void> {
    const stream = streamOf(event);
    try {
      // Start from the beginning of the stream so that events published before this subscriber
      // connected are not lost.
      await reader.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }

    while (!this.closed) {
      try {
        const claimed = (await reader.xautoclaim(
          stream,
          group,
          this.consumer,
          this.retryAfterMs,
          '0',
          'COUNT',
          20,
        )) as [next: string, entries: StreamEntry[]];
        const fresh = (await reader.xreadgroup(
          'GROUP',
          group,
          this.consumer,
          'COUNT',
          20,
          'BLOCK',
          this.blockMs,
          'STREAMS',
          stream,
          '>',
        )) as [stream: string, entries: StreamEntry[]][] | null;

        for (const [id, fields] of [...claimed[1], ...(fresh?.[0]?.[1] ?? [])]) {
          if (await this.handle(event, handler, fields)) await reader.xack(stream, group, id);
        }
      } catch (error) {
        if (this.closed) return;
        this.logger.error(`Reading ${stream} failed: ${String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  /** Returns whether the entry is done (handled, or impossible to handle) and can be acknowledged. */
  private async handle<TPayload>(
    event: EventDefinition<TPayload>,
    handler: EventHandler<TPayload>,
    fields: string[] | null,
  ): Promise<boolean> {
    // A claimed entry whose data was trimmed from the stream comes back without fields.
    if (!fields) return true;
    const raw = fields[fields.indexOf('payload') + 1];
    let payload: TPayload;
    try {
      payload = event.schema.parse(JSON.parse(raw ?? ''));
    } catch (error) {
      this.logger.error(`Dropping malformed ${event.name} event: ${String(error)}`);
      return true;
    }
    try {
      await handler(payload);
      return true;
    } catch (error) {
      this.logger.error(`Handler for ${event.name} failed and will be retried: ${String(error)}`);
      return false;
    }
  }
}

function streamOf(event: EventDefinition<unknown>): string {
  return `remember-me:events:${event.name}`;
}
