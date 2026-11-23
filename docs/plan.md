# remember.me — v1 plan

Every phase ends with: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`
green, a review by a fresh subagent, a summary in `docs/phases/`, and a commit on the working branch.

## Phase 0: Research and skeleton

- **Goal:** a monorepo whose first commit builds, lints and tests green.
- **Scope:** pnpm + Turborepo workspace; `apps/web` (Next.js), `apps/api` (NestJS + Prisma),
  `packages/shared-types` (Zod); strict TypeScript; ESLint + Prettier; Zod env validation in both apps;
  health endpoint; Dockerfiles, `compose.yaml` (PostgreSQL, MinIO), `.env.example`, `.gitignore`;
  CI workflow; `docs/dependencies.md`.
- **Acceptance:** all gates green from a clean clone; `GET /health` answers 200 with the database up;
  the web home page renders; an app refuses to start with an invalid env.
- **Tests:** env validation (both apps); health endpoint against a real PostgreSQL container; architecture
  test for backend module boundaries; lint rule blocking `gift-creator`/`checkout`/Stripe imports under
  `app/for`; one schema test in `shared-types`.
- **User provides:** nothing.

## Phase 1: Gifts and plan limits

- **Goal:** create and edit a gift through the API with FREE limits enforced.
- **Scope:** `shared-types` contracts (gift, cards per type, reveal, `PLAN_CAPABILITIES`, typed errors);
  Prisma schema and migrations for `gifts` and `gift_cards`; `gifts` module: create (returns edit token
  once), read for editing, update, card CRUD and reorder, publish, delete, public read by slug,
  slug availability; `EventBus` interface with memory and redis drivers.
- **Acceptance:** a FREE gift accepts 3 `PHOTO_TEXT` cards and rejects a 4th card, an `AUDIO_NOTE`, a
  `TRIVIA` and a premium reveal template with `PREMIUM_REQUIRED`; write endpoints reject a missing or wrong
  token; the public read never exposes the token or unpublished gifts.
- **Tests:** unit tests for the limit policy; integration tests for every endpoint and rejection;
  event bus contract test run against both drivers.
- **User provides:** nothing.

## Phase 2: Media and QR

- **Goal:** upload media and get a QR code.
- **Scope:** `media` module (image → WebP with sharp, M4A/MP3 audio, type and size limits, S3-compatible
  storage, public URLs); `qr` module (PNG and SVG; high quality only for premium); deleting a gift removes
  its media through an event.
- **Acceptance:** a JPEG upload is stored as WebP and is retrievable; an unsupported type or oversized file
  is rejected; the QR decodes to `<web origin>/for/<slug>`.
- **Tests:** integration tests against MinIO; QR round-trip (generate, decode, compare URL).
- **User provides:** nothing (R2 credentials are only needed for deployment).

## Phase 3: Payments

- **Goal:** pay once, gift becomes premium.
- **Scope:** `payments` module with `payment_orders` and `payment_webhook_logs` (no FK to `gifts`);
  `POST /payments/checkout-session`, `POST /payments/webhook`, `GET /payments/prices`;
  `PaymentSucceededEvent`; subscriber in `gifts` (premium, custom slug, publish, `customSlugPending`);
  env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PREMIUM`,
  `STRIPE_PRICE_ID_CUSTOM_SLUG`.
- **Acceptance:** a session has one line item, or two with the order bump, and the metadata; a webhook with
  a bad signature is rejected; a valid `checkout.session.completed` upgrades the gift exactly once even if
  delivered twice; a taken custom slug still upgrades the gift and sets `customSlugPending`; the
  architecture test proves `payments` and `gifts` do not import each other.
- **Tests:** webhook tests with payloads signed with a test secret (recorded Stripe fixtures); idempotency
  test; integration test of the full event path with the Stripe client behind an adapter.
- **User provides:** Stripe test keys and the two test price IDs, to run it against real Stripe. Tests do
  not need them.

## Phase 4: Gift creator and checkout UI

- **Goal:** build, upgrade and publish a gift from a phone.
- **Scope:** `gift-creator` (card editor, reorder, reveal picker, client image compression, voice note
  recording/upload, edit-link screen, publish, delete); `checkout` (`PremiumUpgradeSheet` with every
  trigger, order bump toggle with live slug preview and availability, redirect); success page with polling
  and QR download; es/en messages; landing page.
- **Acceptance:** each upgrade trigger opens the sheet; prices shown come from the API; the success page
  shows the QR download only once the gift is premium; the editor reopens from the edit link on another
  browser.
- **Tests:** component tests for the sheet triggers and the slug field; unit test for the polling hook;
  Playwright: create a FREE gift and publish it.
- **User provides:** nothing.

## Phase 5: Gift experience and reveal

- **Goal:** the recipient experience behind the QR.
- **Scope:** `app/for/[slug]` isolated layout; `gift-experience` (stories navigation, progress, audio
  playback, trivia, `usePreloadMedia`); `gift-reveal` (basic, `SCRATCH_CARD`, `TICKET`, `GIFT_BOX`,
  confetti, watermark for FREE); not-found and unpublished states.
- **Acceptance:** the route loads no creator, checkout or Stripe code (lint rule plus bundle check);
  media of the next cards is requested while viewing the current one; FREE shows the watermark, PREMIUM
  does not; the scratch reveal completes on touch and mouse.
- **Tests:** unit tests for the preload hook and stories reducer; component tests per reveal; Playwright
  smoke test of the whole flow (create → publish → open `/for/[slug]` → reveal).
- **User provides:** nothing.

## Phase 6: Hardening and final check

- **Goal:** runnable with `docker compose up`, ready for a first deploy.
- **Scope:** rate limiting, CORS, security headers, upload limits review, privacy notice page, `backup.sh`,
  tag-triggered `deploy.yml`, README with the run and deploy steps.
- **Acceptance:** `docker compose up` starts web, api, PostgreSQL and MinIO; health endpoint and the
  Playwright smoke test pass against the composed stack.
- **Tests:** smoke test against compose.
- **User provides:** Stripe live account with Apple Pay, Google Pay and Bizum enabled in the Dashboard
  (Bizum needs Stripe approval), the two live prices, webhook endpoint secret, Cloudflare R2 bucket and
  keys, domain and VPS, repo secrets for the deploy workflow.
