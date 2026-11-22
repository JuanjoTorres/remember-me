import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent, type EventBus } from '../src/shared/events/event-bus.js';
import { MemoryEventBus } from '../src/shared/events/memory-event-bus.js';
import { RedisEventBus } from '../src/shared/events/redis-event-bus.js';

const schema = z.object({ id: z.string() });
let sequence = 0;
/** A new event name per test keeps the tests independent on the shared Redis. */
const newEvent = () => defineEvent(`test.event.${Date.now()}.${(sequence += 1)}`, schema);

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the event');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let redis: StartedRedisContainer;
const redisBuses: RedisEventBus[] = [];

beforeAll(async () => {
  redis = await new RedisContainer('redis:8-alpine').start();
});

afterAll(async () => {
  await Promise.all(redisBuses.map((bus) => bus.close()));
  await redis.stop();
});

function redisBus(): RedisEventBus {
  const bus = new RedisEventBus(redis.getConnectionUrl(), { retryAfterMs: 200, blockMs: 100 });
  redisBuses.push(bus);
  return bus;
}

const drivers: [name: string, create: () => EventBus][] = [
  ['memory', () => new MemoryEventBus(new EventEmitter2())],
  ['redis', redisBus],
];

describe.each(drivers)('EventBus contract: %s driver', (_name, create) => {
  it('delivers a published event to every subscriber', async () => {
    const bus = create();
    const event = newEvent();
    const received: string[] = [];
    bus.subscribe(event, 'gifts', async ({ id }) => void received.push(`gifts:${id}`));
    bus.subscribe(event, 'media', async ({ id }) => void received.push(`media:${id}`));

    await bus.publish(event, { id: 'order-1' });
    await waitFor(() => received.length === 2);
    expect(received.sort()).toEqual(['gifts:order-1', 'media:order-1']);
  });

  it('does not deliver other events', async () => {
    const bus = create();
    const [wanted, other] = [newEvent(), newEvent()];
    const received: string[] = [];
    bus.subscribe(wanted, 'gifts', async ({ id }) => void received.push(id));

    await bus.publish(other, { id: 'ignored' });
    await bus.publish(wanted, { id: 'wanted' });
    await waitFor(() => received.length === 1);
    expect(received).toEqual(['wanted']);
  });

  it('refuses to publish a payload that breaks the contract', async () => {
    const bus = create();
    await expect(
      bus.publish(newEvent(), { id: 42 } as unknown as { id: string }),
    ).rejects.toThrow();
  });
});

describe('memory driver', () => {
  it('fails the publish when a handler fails, so the publisher can retry', async () => {
    const bus = new MemoryEventBus(new EventEmitter2());
    const event = newEvent();
    bus.subscribe(event, 'gifts', async () => {
      throw new Error('database is down');
    });
    await expect(bus.publish(event, { id: 'order-1' })).rejects.toThrow('database is down');
  });
});

describe('redis driver', () => {
  it('redelivers an event until its handler succeeds', async () => {
    const bus = redisBus();
    const event = newEvent();
    let attempts = 0;
    bus.subscribe(event, 'gifts', async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('not yet');
    });

    await bus.publish(event, { id: 'order-1' });
    await waitFor(() => attempts === 3);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(attempts).toBe(3);
  });

  it('delivers events published before the subscriber connected', async () => {
    const event = newEvent();
    await redisBus().publish(event, { id: 'early' });

    const received: string[] = [];
    redisBus().subscribe(event, 'gifts', async ({ id }) => void received.push(id));
    await waitFor(() => received.length === 1);
    expect(received).toEqual(['early']);
  });

  it('shares events between instances of the same subscriber', async () => {
    const event = newEvent();
    const received: string[] = [];
    redisBus().subscribe(event, 'gifts', async ({ id }) => void received.push(id));
    redisBus().subscribe(event, 'gifts', async ({ id }) => void received.push(id));

    const publisher = redisBus();
    for (const id of ['a', 'b', 'c', 'd']) await publisher.publish(event, { id });
    await waitFor(() => received.length >= 4);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(received.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
