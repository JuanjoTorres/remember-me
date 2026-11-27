import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PaymentSucceededEvent } from '../../shared/events/contracts.js';
import { EventBus } from '../../shared/events/event-bus.js';
import { GiftsService } from './gifts.service.js';

/** Upgrades a gift when the payments module reports a confirmed payment. */
@Injectable()
export class PaymentSucceededSubscriber implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly gifts: GiftsService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(
      PaymentSucceededEvent,
      'gifts',
      ({ orderId, giftId, customSlug, customerEmail }) =>
        this.gifts.applyPayment(orderId, giftId, customSlug, customerEmail ?? null),
    );
  }
}
