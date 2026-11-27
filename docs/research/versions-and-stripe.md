# Research: toolchain versions and Stripe Checkout

Checked on 2026-11-22.

## Package versions (npm registry, `npm view <pkg> version license`)

| Package                   | Latest                             | License    | Notes                                                                                                                            |
| ------------------------- | ---------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| pnpm                      | 12.21.0                            | MIT        | Installed through corepack (not present on the dev machine yet)                                                                  |
| turbo                     | 2.11.13                            | MIT        |                                                                                                                                  |
| typescript                | 7.0.2                              | Apache-2.0 | New major. Verify NestJS/Next/Prisma tooling compatibility in Phase 0; fall back to the latest 6.x if a tool does not support it |
| next                      | 16.4.6                             | MIT        | Node >= 20.9                                                                                                                     |
| react                     | 19.3.1                             | MIT        |                                                                                                                                  |
| tailwindcss               | 4.3.5                              | MIT        |                                                                                                                                  |
| framer-motion / motion    | 14.14.0                            | MIT        |                                                                                                                                  |
| @tanstack/react-query     | 5.108.3                            | MIT        |                                                                                                                                  |
| canvas-confetti           | 1.9.4                              | ISC        |                                                                                                                                  |
| next-intl                 | 4.15.3                             | MIT        | es + en UI                                                                                                                       |
| @nestjs/core              | 12.6.0                             | MIT        | Node >= 20                                                                                                                       |
| @nestjs/event-emitter     | 12.0.3                             | MIT        | Node >= 20.19                                                                                                                    |
| prisma (CLI)              | `latest` tag points at 8.0.0-rc.34 | Apache-2.0 | Release candidate: do not use                                                                                                    |
| @prisma/client            | 7.10.1                             | Apache-2.0 | Pin CLI and client to the same 7.10.x stable                                                                                     |
| zod                       | 4.6.7                              | MIT        |                                                                                                                                  |
| stripe                    | 23.2.0                             | MIT        |                                                                                                                                  |
| sharp                     | 0.35.5                             | Apache-2.0 |                                                                                                                                  |
| qrcode                    | 1.5.4                              | MIT        | SVG and PNG output                                                                                                               |
| @aws-sdk/client-s3        | 3.1175.0                           | Apache-2.0 | Cloudflare R2 / MinIO                                                                                                            |
| browser-image-compression | 2.0.2                              | MIT        | Client-side compression                                                                                                          |
| vitest                    | 5.1.1                              | MIT        | Node ^22.12 / ^24                                                                                                                |
| @playwright/test          | 1.65.1                             | Apache-2.0 |                                                                                                                                  |
| eslint                    | 10.15.0                            | MIT        |                                                                                                                                  |
| prettier                  | 3.10.1                             | MIT        |                                                                                                                                  |
| ioredis                   | 6.0.0                              | MIT        | Only for `EVENT_BUS_DRIVER=redis`                                                                                                |

Local runtime: Node v24.14.0, Docker 29.5.3. No package above needs a commercial license.

## Stripe (official docs)

Sources:

- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/payments/payment-methods/integration-options
- https://docs.stripe.com/payments/bizum
- https://docs.stripe.com/payments/bizum/accept-a-payment?payment-ui=checkout
- https://docs.stripe.com/payments/checkout/upsells

Findings:

- Current API version: `2026-11-18.endive`.
- **Payment methods:** Stripe recommends dynamic payment methods for Checkout: do not list methods in code,
  enable them in the Dashboard. From API version `2026-09-30.endive` Checkout Sessions no longer accept
  `payment_method_types`. Restriction in code, if ever needed, uses `allowed_payment_method_types` /
  `excluded_payment_method_types`. Wallets (Apple Pay, Google Pay, Link) are displayed dynamically by hosted
  Checkout.
- **Bizum:** supported in hosted Checkout (`mode=payment`), EUR only, customers in Spain only,
  0.50–5,000.00 EUR, B2C. Access type is "Approval required" (early-access onboarding). It cannot be forced
  from code on the current API version: it appears once the account is approved and the method is enabled in
  the Dashboard.
- **Update 2026-11-23:** Checkout does have native optional items; see `stripe-plan-review.md`.
- **Order bump:** the upsell docs only cover subscription upsells (Dashboard-configured). Nothing was verified
  for one-time optional items inside hosted Checkout, so the order bump is implemented in our own
  `PremiumUpgradeSheet` (checkbox before redirect) and sent as a second `line_item`.

Consequences for the design:

- `POST /payments/checkout-session` creates a `mode=payment` session with no payment-method list.
- Sessions must be in EUR so that Bizum can be offered.
- Enabling Bizum, Apple Pay and Google Pay is a Dashboard task for the account owner (see plan, "What the user
  must provide").
