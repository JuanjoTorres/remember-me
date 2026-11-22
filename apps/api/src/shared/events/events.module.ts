import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { EventBus } from './event-bus.js';
import { MemoryEventBus } from './memory-event-bus.js';
import { RedisEventBus } from './redis-event-bus.js';

@Injectable()
class EventBusLifecycle implements OnModuleDestroy {
  constructor(@Inject(EventBus) private readonly bus: EventBus) {}

  async onModuleDestroy(): Promise<void> {
    if (this.bus instanceof RedisEventBus) await this.bus.close();
  }
}

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    {
      provide: EventBus,
      inject: [ENV, EventEmitter2],
      useFactory: (env: Env, emitter: EventEmitter2): EventBus =>
        env.EVENT_BUS_DRIVER === 'redis' && env.REDIS_URL
          ? new RedisEventBus(env.REDIS_URL)
          : new MemoryEventBus(emitter),
    },
    EventBusLifecycle,
  ],
  exports: [EventBus],
})
export class EventsModule {}
