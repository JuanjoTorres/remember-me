import type { z } from 'zod';

/** Name and payload contract of something that happened. Modules only share these definitions. */
export interface EventDefinition<TPayload> {
  readonly name: string;
  readonly schema: z.ZodType<TPayload>;
}

export function defineEvent<TPayload>(
  name: string,
  schema: z.ZodType<TPayload>,
): EventDefinition<TPayload> {
  return { name, schema };
}

export type EventHandler<TPayload> = (payload: TPayload) => Promise<void>;

/**
 * The only channel between modules. Delivery is at least once: handlers must be idempotent.
 *
 * - `memory`: handlers run inside `publish`, which rejects if one of them fails.
 * - `redis`: `publish` resolves once the event is stored; failed handlers are retried later.
 */
export abstract class EventBus {
  abstract publish<TPayload>(event: EventDefinition<TPayload>, payload: TPayload): Promise<void>;

  /** `subscriber` names the consumer (usually the module); each subscriber gets every event once. */
  abstract subscribe<TPayload>(
    event: EventDefinition<TPayload>,
    subscriber: string,
    handler: EventHandler<TPayload>,
  ): void;
}
