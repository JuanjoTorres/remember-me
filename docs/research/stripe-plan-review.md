# Research: Stripe implementation plan review

Checked on 2026-11-23 with Stripe's implementation planner and documentation search (Stripe agent
tooling), against the test account of the project.

## Plan returned by Stripe

For "one-time payments for digital goods, in a web browser, Stripe only": **Stripe-hosted Checkout**,
`mode=payment`, pre-created Prices as line items, fulfilment from the `checkout.session.completed`
webhook. Principles: keep dynamic payment methods, Link and Adaptive Pricing enabled.

This is the shape already built in `apps/api/src/modules/payments`.

## Differences found and what was done

| Stripe guidance                                                                                     | Before                                                                                         | Now                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Handle `checkout.session.async_payment_failed`                                                      | Not handled: the order stayed open and its dead session was handed out again for 23 hours      | The order is closed; the next checkout creates a new session                                                                               |
| Do not rely on the webhook alone: also check the session when the customer lands on the return page | The return page only polled the gift, so a late or lost webhook left a paying customer waiting | `POST /payments/confirm` asks Stripe for the session and runs the same fulfilment; the return page calls it on arrival and every few polls |

`POST /payments/confirm` asks Stripe at most once every 8 seconds per order, announces a recorded payment
again if the gift was left behind, and closes an order whose session expired at Stripe.

## Not changed (decisions for the owner)

- **Tax.** Digital goods sold to EU consumers carry VAT of the customer's country. Checkout can calculate it
  (`automatic_tax`, Stripe Tax), or Stripe can act as merchant of record (Managed Payments). Neither is
  enabled: prices are charged as configured. This needs a decision with your tax adviser before going live.
- **Optional items.** Checkout has a native "optional items" feature
  (https://docs.stripe.com/payments/checkout/optional-items) that could show the custom link as an add-on
  inside the Stripe page. The order bump stays in our own upgrade sheet, as specified, because the link has
  to be typed and checked for availability before paying.
- **Adaptive Pricing and Link** are Dashboard settings. Bizum is only offered when the session is in EUR;
  Adaptive Pricing only changes the currency for customers outside the euro area.

## Test account

Two one-time EUR prices already exist in the test account: "Complete Gift Experience" (4.99 EUR) and
"Enlace personalizado" (1.99 EUR). Their price IDs go in `STRIPE_PRICE_ID_PREMIUM` and
`STRIPE_PRICE_ID_CUSTOM_SLUG`.
