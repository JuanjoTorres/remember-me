# kardoo.me — v1 spec

## Problem

Giving something digital (a trip, tickets, a plan, a message) feels flat. kardoo.me turns it into a small
experience: the recipient scans a QR code and goes through a story of photos, messages, voice notes and an
optional trivia question, ending in an interactive surprise reveal.

## Users

- **Creator:** builds the gift on their phone, without signing up. Pays once per gift if they want the full
  experience. Their email is captured by Stripe Checkout.
- **Recipient:** scans the QR code and opens `/for/[slug]` on a phone. No account, no app install.

## v1 flows

1. **Create a gift** (`/create`): add cards, choose a reveal template, write the reveal content. Images are
   compressed in the browser before upload. The draft is saved on the server from the first step.
2. **Come back to a gift:** creating a gift returns a secret edit link (`/create/[giftId]?token=…`). The token
   is stored on the device and shown to the creator to save. All write endpoints require it.
3. **Publish for free:** a FREE gift can be published and gets a QR code, within the free limits.
4. **Upgrade** (`PremiumUpgradeSheet`): opens when the creator tries to add a voice note, a trivia card, a
   fourth card, a premium reveal template, or taps "Publish without watermark". Optional order bump for a
   custom slug with a live preview of `kardoo.me/for/[slug]`. Redirects to Stripe Checkout.
5. **Payment return** (`/create/[giftId]/success`): polls the gift until the webhook has been processed, then
   shows the final QR download (SVG/PNG).
6. **Experience the gift** (`/for/[slug]`): full-screen stories, background preload of the next cards' media,
   optional trivia, then the reveal (scratch card, ticket or gift box) with confetti.

## Plans

Prices live in Stripe (`STRIPE_PRICE_ID_PREMIUM`, `STRIPE_PRICE_ID_CUSTOM_SLUG`); the UI reads amounts from
the API, never from constants. Limits live in one `PLAN_CAPABILITIES` contract in `shared-types`.

|                                    | FREE         | PREMIUM (one-time, e.g. 4.99 €)      |
| ---------------------------------- | ------------ | ------------------------------------ |
| Cards per gift                     | 3            | Unlimited                            |
| Card types                         | `PHOTO_TEXT` | `PHOTO_TEXT`, `AUDIO_NOTE`, `TRIVIA` |
| Reveal templates                   | Basic        | `SCRATCH_CARD`, `TICKET`, `GIFT_BOX` |
| Watermark "Created with kardoo.me" | Yes          | No                                   |
| QR download                        | Standard PNG | High quality SVG/PNG                 |

Order bump `CUSTOM_SLUG` (e.g. +1.99 €): the creator chooses the slug instead of the generated one.
Only available together with PREMIUM in the same checkout.

## Non-goals for v1

- User accounts, login, magic links, a "my gifts" dashboard.
- Transactional email sent by us (Stripe sends the receipt; the edit link is shown on screen).
- Video cards, more than one trivia question per gift, scheduled delivery, gift expiry.
- Refund handling in-app (done from the Stripe Dashboard), invoices, coupons.
- Kubernetes manifests, Redis event bus in production (the driver exists, compose runs `memory`).
- Analytics, admin back office, content moderation tooling.

## Data model sketch

- `gifts`: `id`, `slug` (unique), `editTokenHash`, `status` (`DRAFT` | `PUBLISHED`), `isPremium`,
  `revealTemplate`, `revealPayload` (JSON: title, message, optional image), `locale`, timestamps.
- `gift_cards`: `id`, `giftId` (FK), `position`, `type` (`PHOTO_TEXT` | `AUDIO_NOTE` | `TRIVIA`),
  `payload` (JSON validated with Zod per type), media keys.
- `media_assets`: `id`, `giftId` (plain string, no FK), `kind` (`IMAGE` | `AUDIO`), `storageKey`,
  `contentType`, `bytes`, `status`.
- `payment_orders`: `id`, `giftId` (plain string, **no relation**), `stripeSessionId` (unique), `status`,
  `amountTotal`, `currency`, `includeCustomSlug`, `customSlug`, timestamps.
- `payment_webhook_logs`: `eventId` (unique), `type`, `processedAt`.

## Backend rules

- Modules `gifts`, `media`, `qr`, `payments`. No module imports another module's services or repositories;
  an architecture test fails the build if one does. Cross-module communication goes through `EventBus`.
- `gifts` enforces plan limits on card create/update and on reveal template selection, and rejects with the
  typed error `PREMIUM_REQUIRED` (with the capability that was hit).
- `payments`:
  - `POST /payments/checkout-session` `{ giftId, includeCustomSlug, customSlug?, successUrl, cancelUrl }`:
    Stripe Checkout, `mode=payment`, EUR, dynamic payment methods, one or two `line_items`, data in
    `metadata`. `successUrl`/`cancelUrl` must belong to the configured web origin.
  - `POST /payments/webhook`: verifies the signature with `STRIPE_WEBHOOK_SECRET` on the raw body, inserts
    `eventId` into `payment_webhook_logs` (duplicate → 200 and no effect), publishes
    `PaymentSucceededEvent { giftId, orderId, customSlug? }`.
  - `GET /payments/prices`: amounts and currency of the two prices, read from Stripe and cached.
- `gifts` subscribes to `PaymentSucceededEvent`: sets `isPremium = true`, applies `customSlug`, publishes the
  gift. The handler is idempotent.
- **Custom slug availability:** `payments` cannot ask `gifts` directly. The web checks availability with
  `GET /gifts/slug-availability` before checkout. If the slug was taken in the meantime, `gifts` keeps the
  generated slug, still upgrades the gift and flags `customSlugPending` so the creator can pick another one
  for free from the editor.
- `media`: image → WebP with sharp; audio M4A/MP3 stored as is; size and type limits; upload to
  S3-compatible storage. `qr`: PNG/SVG for the gift URL built from the public web origin.
- Env validated with Zod at startup in `src/config/env.ts` of each app.

## Frontend rules

- `src/features/`: `gift-creator`, `gift-experience`, `gift-reveal`, `checkout`, `shared`.
- `app/for/[slug]`: isolated full-screen layout (`100dvh`), no imports from `gift-creator`, `checkout` or
  Stripe; enforced by a lint rule. Server-rendered fetch through `INTERNAL_API_URL`; the browser uses
  `NEXT_PUBLIC_API_URL`.
- `usePreloadMedia` preloads the media of the following cards while the current one is shown.
- UI in Spanish and English (next-intl), locale from the browser.

## External dependencies

Stripe (Checkout, webhooks), Cloudflare R2 (MinIO locally), PostgreSQL.

## Risks

- **Bizum needs Stripe approval.** Until the account is approved it will not appear in Checkout. Card,
  Apple Pay and Google Pay do not depend on it.
- **Lost edit link:** without email delivery, a creator who clears their browser and did not save the link
  loses edit access. The gift itself keeps working. Mitigation in v1: clear "save this link" step.
- **Eventual consistency** between payment and gift: the success page must poll and handle a slow webhook.
- **User-generated content** is public behind an unguessable slug; there is no moderation in v1.
- **GDPR:** photos and voice notes are personal data. v1 needs a privacy notice and a way to delete a gift
  (creator can delete from the editor; this removes media from storage).
- **TypeScript 7** is a new major; tool support is verified in Phase 0.

## Open questions

Questions 1, 2 and 4 were built as assumed below and still need the owner's confirmation.

1. Can a FREE gift be published at all, or is it preview-only until payment? This spec assumes it **can be
   published** with limits and watermark (the "Publish without watermark" trigger implies it).
2. Which reveal is the "basic" FREE template? This spec assumes a simple tap-to-open card, separate from
   the three premium templates.
3. Final prices and Stripe products are created by the account owner; 4.99 € and 1.99 € are examples.
4. The project `CLAUDE.md` says the QR points to `https://remember.me[slug]`; this spec uses
   `<web origin>/for/[slug]`, consistent with section 1 of the same file.
5. The product was first called remember.me. That domain was not available, so the public brand is
   kardoo.me. `CLAUDE.md`, the repository and the package scope (`@remember-me/*`) keep the old name.
