# Events

Read this before adding an event or a subscriber, or touching the event bus and its drivers.

Events are the only channel between modules. A module never calls another module's service.

## Files

| File                                             | Role                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `apps/api/src/shared/events/event-bus.ts`        | `EventBus` abstract class, `EventDefinition`, `defineEvent`, `EventHandler` |
| `apps/api/src/shared/events/contracts.ts`        | Every event: name, Zod payload schema, payload type                         |
| `apps/api/src/shared/events/memory-event-bus.ts` | `MemoryEventBus`, on `@nestjs/event-emitter`                                |
| `apps/api/src/shared/events/redis-event-bus.ts`  | `RedisEventBus`, on Redis Streams (`ioredis`)                               |
| `apps/api/src/shared/events/events.module.ts`    | Global module; picks the driver; closes Redis connections on shutdown       |

## Interface

- `publish(event, payload)`: validates the payload against the event's schema (an invalid payload
  rejects) and hands it to the driver.
- `subscribe(event, subscriber, handler)`: `subscriber` names the consumer, by convention the module name.
  Each distinct subscriber name gets every event once.

Inject the abstract class `EventBus`; never a driver.

## Drivers

`EVENT_BUS_DRIVER` selects the driver in the factory of `apps/api/src/shared/events/events.module.ts`:
`redis` (with `REDIS_URL`, which the env schema then requires) gives `RedisEventBus`, anything else
`MemoryEventBus`. Compose files and tests run `memory`.

|                         | memory                                                 | redis                                                        |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `publish` resolves      | After every handler ran                                | Once the event is stored in the stream                       |
| Handler fails           | `publish` rejects; the publisher decides (fail, retry) | Not acknowledged; claimed and retried after `retryAfterMs`   |
| Subscriber name         | Ignored                                                | Consumer group: instances with the same name share the work  |
| Events before subscribe | Lost                                                   | Delivered: the group starts from the beginning of the stream |
| Malformed stored event  | —                                                      | Logged and dropped                                           |
| Retention               | —                                                      | Streams are trimmed to about `STREAM_MAX_LENGTH` entries     |
| Across processes        | No                                                     | Yes                                                          |

The stream key of an event is the prefix in `streamOf` plus the event name.

Two flows today rely on the memory driver's "publish rejects when a handler fails": a failed gift upgrade
makes the webhook answer 500 so Stripe retries, and a failed media cleanup keeps the gift from being
deleted. Under redis both become eventual (the driver retries the handler instead). Code must be correct
under both: handlers idempotent, publishers not assuming the effect already happened.

## Delivery semantics

At least once, in no guaranteed order. Every handler must be idempotent and tolerate an old event arriving
after a newer one. Existing examples: `applied_order_ids` in `GiftsService.applyPayment`; the status guard
in `PaymentsService.markRefundDue`; the per-file loop in `MediaService.deleteAllOf`.

## Event contracts

| Constant                | Name                | Payload                                                           | Publisher                                                                | Subscribers (name → handler)                                                                                 |
| ----------------------- | ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `PaymentSucceededEvent` | `payment.succeeded` | `orderId` string, `giftId` UUID, `customSlug` string or null      | `PaymentsService.announce` (from `settle`, and re-announce in `confirm`) | "gifts" → `GiftsService.applyPayment`, wired in `apps/api/src/modules/gifts/payment-succeeded.subscriber.ts` |
| `GiftDeletedEvent`      | `gift.deleted`      | `giftId` UUID                                                     | `GiftsService.remove`, before the gift row is deleted                    | "media" → `MediaService.deleteAllOf`, wired in `MediaService.onModuleInit`                                   |
| `PaymentUnappliedEvent` | `payment.unapplied` | `orderId` string, `giftId` UUID, `reason` (only `GIFT_NOT_FOUND`) | `GiftsService.applyPayment` when the gift no longer exists               | "payments" → `PaymentsService.markRefundDue`, wired in `PaymentsService.onModuleInit`                        |

Payloads carry ids and the minimum facts, not rows. `payment.succeeded` takes `customSlug` from the
module's own order, not from Stripe.

## Recipe: add an event

1. Define it in `apps/api/src/shared/events/contracts.ts` with `defineEvent(name, schema)` and export the
   payload type with `z.infer`. Name: `<noun>.<past-tense verb>`, lowercase, dot separated.
2. Publish from the owning service with `this.events.publish(Event, payload)`. Decide where the publish
   sits relative to your own write, knowing that under the memory driver a failing handler rejects the
   publish (see `GiftsService.remove`: announce first, delete after).
3. Subscribe in the consuming module, in `onModuleInit` of a provider registered in that module. Either a
   dedicated subscriber class (model: `apps/api/src/modules/gifts/payment-succeeded.subscriber.ts`) or the
   service itself (model: `apps/api/src/modules/media/media.service.ts`). Pass the module name as
   `subscriber`.
4. Make the handler idempotent and say in a comment what makes it so.
5. Changing a payload: with redis, old events may still be in the stream. Add fields as optional or
   nullable; never repurpose a field.

## Decisions

None recorded yet.

## Change checklist

- `apps/api/src/shared/events/contracts.ts`, the publisher, the subscriber.
- Tests: the behaviour through HTTP in the publisher's test file, and the handler by publishing on the bus
  from the test (model: the "payment events" block in `apps/api/test/gifts.test.ts`). Include a repeated
  delivery.
- Driver change: `apps/api/test/event-bus.test.ts` runs one contract suite against both drivers; extend
  it, do not fork it.
- Update the contracts table in this file and the reference of each module involved
  (`gifts.md`, `media-qr.md`, `payments.md` in `.claude/skills/backend/references/`).
