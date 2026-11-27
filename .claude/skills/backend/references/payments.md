# Payments module

Read this before touching checkout, orders, the Stripe webhook, payment confirmation or the gateway.

## Files

| File                                                      | Role                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/src/modules/payments/payments.controller.ts`    | Four routes; the webhook reads `request.rawBody`                   |
| `apps/api/src/modules/payments/payments.service.ts`       | Orders, reuse, webhook idempotency, confirm, settle, refund flag   |
| `apps/api/src/modules/payments/payment-gateway.ts`        | `PaymentGateway` abstraction and its provider-neutral types        |
| `apps/api/src/modules/payments/stripe-payment-gateway.ts` | The only implementation; `STRIPE_CLIENT` injection token           |
| `apps/api/src/modules/payments/payments.module.ts`        | Builds the Stripe client (`createStripeClient`), binds the gateway |

## Isolation (from `CLAUDE.md`, do not relax)

- The module owns `payment_orders` and `payment_webhook_logs`. Neither has a relation or foreign key to
  any other table; `giftId` is a plain string. A test queries the database catalog to prove it.
- It never imports another module and never reads the `gifts` tables. What it knows about a gift comes
  from the grant claims (`giftId`, `plan`) and from its own orders.
- It tells the rest of the app about a payment only by publishing `payment.succeeded`, and hears back only
  through `payment.unapplied`. See `.claude/skills/backend/references/events.md`.
- `stripe` is imported only in this folder. `PaymentsService` uses `PaymentGateway`, never the SDK.

## Order states (`PaymentOrderStatus`)

| From      | To           | When                                                                                               |
| --------- | ------------ | -------------------------------------------------------------------------------------------------- |
| (new)     | `PENDING`    | `createCheckoutSession` creates the order                                                          |
| `PENDING` | `EXPIRED`    | Replaced by a new checkout; Stripe says expired or async payment failed; `confirm` sees it expired |
| any       | `PAID`       | `settle`: a paid session, and no other order of the gift is `PAID`                                 |
| any       | `REFUND_DUE` | `settle`: another order of the gift is already `PAID`, or this order was already `REFUND_DUE`      |
| `PAID`    | `REFUND_DUE` | `markRefundDue`: `gifts` reported the gift no longer exists (`payment.unapplied`)                  |

`EXPIRED` updates are guarded with `status: PENDING`, so a paid order is never downgraded. `REFUND_DUE`
only writes an error log line starting with "REFUND DUE"; the refund itself is done by hand in Stripe.

## Checkout session (`createCheckoutSession`)

1. The grant must be for the gift in the body (`UNAUTHORIZED`), and its plan must not be `PREMIUM`
   (`CONFLICT`).
2. Redirect check: the origin of `successUrl` and `cancelUrl` must equal `WEB_ORIGIN`
   (`VALIDATION_ERROR`). This keeps the endpoint from being an open redirect.
3. Under a per-gift advisory lock ("checkout:" + gift id), on this module's own orders:
   - a `PAID` order exists: `CONFLICT` (the grant may be stale);
   - an open order with a checkout URL, the same custom slug, and younger than `SESSION_REUSE_MS` exists:
     return it (second tab, double tap). Stripe is not called;
   - otherwise mark the gift's open orders `EXPIRED` and create a new `PENDING` order.
4. Outside the transaction: expire the Stripe sessions of the replaced orders (an old tab must not be able
   to pay), create the session, store `stripeSessionId` and `checkoutUrl` on the order.

The gateway creates the session in `payment` mode with one line item per price id
(`STRIPE_PRICE_ID_PREMIUM`, plus `STRIPE_PRICE_ID_CUSTOM_SLUG` for the order bump), the order id as
`client_reference_id` and in the metadata, and the idempotency key "checkout-" + order id.

## Prices (`getPrices`)

Read from Stripe for the two price ids and cached in memory per instance for `PRICES_TTL_MS`.

## Webhook (`handleWebhook`)

1. `parseWebhook` verifies the signature over the raw body with `STRIPE_WEBHOOK_SECRET`
   (`UNAUTHORIZED` otherwise) and reduces the Stripe event to a `PaymentEvent`:
   - completed or async-payment-succeeded with `payment_status` paid: `paid`;
   - completed but not yet paid (delayed method): `ignored`;
   - expired or async-payment-failed: `expired`;
   - anything else: `ignored`.
2. Idempotency log: insert the event id into `payment_webhook_logs` (`createMany` with `skipDuplicates`,
   one atomic statement), read the row, and stop if `processedAt` is set.
3. `process` finds the order by the order id in the event (if it is a UUID) or by session id. No order:
   warn and acknowledge (another product on the same Stripe account).
4. `processedAt` is set only after `process` returned. If anything throws (for example a subscriber
   failing under the memory driver), the response is 500, Stripe retries, and the event runs again.

Every step after the log must therefore be safe to repeat.

## Simultaneous checkouts

The Stripe session is created after the transaction that reserves the order, so for a moment an order
exists without its checkout page.

- A second request for the same purchase in that moment (a double tap, a second tab) must not replace it,
  or one purchase would get two payable sessions. An order with no `checkoutUrl`, the same custom link and
  younger than `SESSION_IN_FLIGHT_MS` is taken to be in flight: the second request waits for its page
  (`checkoutUrlOf`) and returns the same one.
- If Stripe fails, the order is set to `EXPIRED` at once, so the customer can try again immediately and a
  request that was waiting stops waiting. A waiting request whose order failed or took too long opens the
  checkout itself, once; it never answers `CONFLICT`, which the web shows as "already paid".
- A request for something else (another custom link) replaces the order in flight. When Stripe then
  answers the overtaken request, its order is no longer `PENDING`: the session it just created is expired
  at Stripe and the request fails, so the gift keeps one payable session.
- An order without a page that is older than `SESSION_IN_FLIGHT_MS` is a request that died, and is replaced.

On 2026-11-25 the test of the double tap failed once: before, the second request replaced the order
whenever it arrived inside that moment.

## Settle and announce

`settle` records `paidAt`, session id, amount, currency and the customer's email as reported by Stripe
(`customer_details.email`, read by `emailOf` in the gateway; kept in `payment_orders.customer_email`),
then either flags `REFUND_DUE` (second payment for the gift) or sets `PAID` and calls `announce` with the
updated order. `announce` publishes `payment.succeeded` with the order id, gift id, custom slug and
customer email, all taken from our own order, never straight from the provider's payload. The gifts
module keeps the email for the anniversary email; payments does nothing else with it.

When a gift is deleted (`gift.deleted`), `forgetCustomer` sets `customer_email` to `NULL` on every order
of that gift. The orders themselves stay: they are the record of the payment. The privacy page promises
that the address is deleted with the gift, so a new place that stores it must be cleared here too. An order that ends as `REFUND_DUE` never keeps
the address either (`settle`, `markRefundDue`): the refund is made in Stripe.

## Confirm (`confirm`)

Called by the web return page so a late or lost webhook does not strand a paying customer.

- A `PAID` order exists: answer `PAID`; if the caller's grant is still not premium, announce again (the
  first announcement may have been lost; applying is idempotent per order).
- No order with a Stripe session: `NONE`.
- Throttle: one question to Stripe per order every `SESSION_CHECK_INTERVAL_MS`, tracked in the in-memory
  map `lastSessionCheck` (cleared when it exceeds `SESSION_CHECK_MEMORY` entries); inside the interval the
  answer is `PENDING` without calling Stripe. It is per instance.
- Otherwise ask Stripe: expired closes the order and answers `NONE`; unpaid answers `PENDING`; paid runs
  the same `settle` as the webhook.

## Never

- Never pass `payment_method_types` or any payment method list: Stripe picks the methods enabled in the
  Dashboard. A test asserts no such field is sent.
- Never write an amount or currency in code, tests of behaviour excepted (the fake Stripe needs numbers).
- Never trust the browser's return to the success URL as proof of payment.
- Never set `processedAt` before the event is fully handled, and never swallow an error in between.
- Never add a relation to `gifts`, and never query or import `gifts`.

## How tests fake Stripe

`apps/api/test/payments.test.ts` starts a local HTTP server (`startFakeStripe`) that records every call
and answers the session, expire, retrieve and price endpoints. A real Stripe SDK client pointed at it
replaces `STRIPE_CLIENT` through `overrideProvider`. Webhook deliveries are signed with the SDK's test
header helper and the secret from `apps/api/test/setup.ts`. Sets `paidSessions` and `expiredSessions`
control what a retrieve returns. Tests about simultaneous requests never use a delay:
`holdNextSessionCreation()` makes the server keep the next session creation unanswered until the test
calls `release()`, and `nextRequestWaitingForAPage()` tells when a second request has started waiting.
`STRIPE_API_BASE_URL` does the same for the browser tests
(`apps/web/e2e/fake-stripe.mjs`); the env schema refuses it in staging and production.

## Decisions

None recorded yet.

## Change checklist

- New provider call: a method on `PaymentGateway`, implemented in
  `apps/api/src/modules/payments/stripe-payment-gateway.ts`, and a route in `startFakeStripe` (and in
  `apps/web/e2e/fake-stripe.mjs` if the browser flow uses it).
- New Stripe event type: `parseWebhook` only; keep unknown types `ignored`.
- New order state or column: `apps/api/prisma/schema.prisma`, a migration, the state table above.
- New thing sold: a Price ID env var (`.claude/skills/backend/references/config-env.md`), the request
  contract in `packages/shared-types/src/payments.ts`, `getPrices`, the event payload if `gifts` must act.
- Tests: `apps/api/test/payments.test.ts`; the gifts side of an event in `apps/api/test/gifts.test.ts`.
- Update this file, `.claude/skills/backend/references/endpoints.md` and
  `.claude/skills/backend/references/events.md` as needed.
