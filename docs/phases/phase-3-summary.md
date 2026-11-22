# Phase 3: Payments (2026-11-23)

## Done

- `payments` module, isolated: tables `payment_orders` and `payment_webhook_logs` with no foreign key to
  the rest of the schema (asserted by a test against the real database), no import of other modules, and
  Stripe imported nowhere else.
- `POST /payments/checkout-session` (gift grant): Stripe Checkout in `payment` mode, one line item, or two
  with the custom link order bump; data in `metadata`; dynamic payment methods; redirect URLs must belong
  to the web origin; refuses a gift that is already premium.
- `POST /payments/webhook`: signature verified over the raw body, idempotent through
  `payment_webhook_logs`, publishes `PaymentSucceededEvent`. Handles `checkout.session.completed`,
  `async_payment_succeeded` (delayed methods) and `expired`. If the upgrade fails it answers 500 and the
  retry from Stripe finishes the job.
- `GET /payments/prices`: amounts read from Stripe, cached 10 minutes.
- `gifts` reacts to the event: premium, custom link, publication of a ready draft.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PREMIUM`,
  `STRIPE_PRICE_ID_CUSTOM_SLUG`, validated at startup (production requires a live key).
- Fixes from the review of Phase 2:
  - Links a published gift had before keep working (`gift_slug_aliases`) and stay reserved, so a QR that
    was already downloaded or printed never breaks when a custom link is applied.
  - Deleting a gift announces it first and deletes the gift last; media deletion is resumable. A storage
    failure leaves the gift in place and the delete can be retried.
  - Audio is validated structurally (MP3 frames; MP4 with a sound track and no video track).
  - The per-gift storage ceiling holds under parallel uploads; a failed upload leaves no record.
  - Updating the headline takes the same lock as publishing.
  - Applied orders are remembered per gift, so an old payment event delivered late changes nothing.
- Tests: 89 in the API. The payment tests run the real Stripe SDK against a local stand-in for the Stripe
  API and sign webhooks with the SDK's own test helper.

- Fixes from the review of this phase:
  - One gift has one open checkout: a double tap or a second tab gets the same Stripe session, a changed
    order expires the previous session, and a gift with a paid order is refused even with an old grant.
  - A payment that cannot be delivered (second payment for the same gift, gift deleted before paying) marks
    the order `REFUND_DUE` and logs an error. `gifts` reports the deleted-gift case with
    `PaymentUnappliedEvent`.
  - Buying the link the gift already has makes that link permanent.
  - Webhook log insertion is atomic under simultaneous deliveries.

## What changed from the plan (and why)

- **No `payment_method_types` / `automatic_payment_methods`:** the current Stripe API no longer accepts a
  method list on Checkout Sessions. Cards, Apple Pay, Google Pay and Bizum come from the Dashboard settings.
- **`checkout.session.async_payment_succeeded` is handled too**, in case a delayed method is enabled.
- **Not verified against the real Stripe API.** No test keys were available; the request shape is checked
  against a local stand-in and the types of `stripe` 23.2.0.

## Pending (not blocking)

- A checkout whose custom link is taken before payment still charges the order bump; the creator then picks
  another link for free. The web checks availability right before redirecting to reduce this.
- Refunds are handled in the Stripe Dashboard and do not downgrade the gift. Orders in `REFUND_DUE` are not
  refunded automatically: look for `REFUND DUE` in the API logs or query `payment_orders`.

## What I need from you

- Stripe test mode: secret key, two one-time EUR prices (full experience, custom link) and a webhook secret
  (`stripe listen --forward-to localhost:4000/payments/webhook`) to try a real payment end to end.

## Proposal for the next phase

- Phase 4 as planned: editor, upgrade sheet and success page in the web app.
