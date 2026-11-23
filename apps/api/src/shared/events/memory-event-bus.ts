import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBus, type EventDefinition, type EventHandler } from './event-bus.js';

/** In-process driver on top of `@nestjs/event-emitter`. Used with `EVENT_BUS_DRIVER=memory`. */
export class MemoryEventBus extends EventBus {
  constructor(private readonly emitter: EventEmitter2) {
    super();
  }

  async publish<TPayload>(event: EventDefinition<TPayload>, payload: TPayload): Promise<void> {
    await this.emitter.emitAsync(event.name, event.schema.parse(payload));
  }

  subscribe<TPayload>(
    event: EventDefinition<TPayload>,
    _subscriber: string,
    handler: EventHandler<TPayload>,
  ): void {
    this.emitter.on(event.name, (payload: TPayload) => handler(payload), { promisify: true });
  }
}
