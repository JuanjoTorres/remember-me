# Phase 1: Gifts and plan limits (2026-11-23)

## Done

- Shared contracts: plans and `PLAN_CAPABILITIES`, cards per type, reveal, gift views, slugs, typed errors.
- `gifts` module: create (edit token returned once, only its hash stored), read, update, card create/update/
  reorder/delete, publish, change slug, delete, public read by slug, slug availability.
- Plan limits enforced in the API with `PREMIUM_REQUIRED` (HTTP 402) and the capability that was hit:
  fourth card, voice note, trivia, premium reveal template. The card limit holds under concurrent requests.
- `EventBus` with two drivers: in-memory (`@nestjs/event-emitter`) and Redis Streams (consumer group per
  subscriber, retry until the handler succeeds).
- `gifts` already subscribes to `PaymentSucceededEvent` (upgrade, custom slug, `customSlugPending`); the
  publisher arrives in Phase 3.
- Tests: 44 in the API (real PostgreSQL and Redis), 10 in shared-types.

## What changed from the plan (and why)

- **Gift grants (new).** Media, QR and payments need to know the gift's plan and that the caller may edit
  it, but they cannot call `gifts`. The gifts module now returns a signed, 30-minute grant
  (`giftId`, `slug`, `plan`, `published`) with every editor response; the other modules verify the
  signature. New env variable `GRANT_SIGNING_SECRET`.
- **Media ownership by URL.** Cards may only reference `<MEDIA_PUBLIC_URL>/gifts/<giftId>/<file>`, so
  `gifts` can check that a file belongs to the gift without asking `media`. New env `MEDIA_PUBLIC_URL`.
- **The link is fixed on first publication** (`sarah-x9k2bd`), so it can carry the recipient's name. Drafts
  have a provisional `gift-…` slug.
- **Redis driver uses Streams, not pub/sub**, to get at-least-once delivery.
- **Technical ceiling of 60 cards per gift**, also for premium, to protect the service.

## Pending (not blocking)

- A paid custom link is applied when the payment arrives. If the gift was published before paying, its
  generated link stops working at that moment (the QR is only final after the success page).

## What I need from you

- Nothing.

## Proposal for the next phase

- Phase 2 as planned: media upload and QR, both authorized with the grant.
