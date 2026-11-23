# Phase 6: Hardening and final check (2026-11-23)

## Done

- API: per-client rate limits (general, and a lower one for starting gifts), hardening headers (helmet),
  proxy awareness for the client IP. Health check and Stripe webhook are never rate limited.
- Web: security headers, privacy page (en/es), error page on the recipient route.
- Docker: both images build; a `migrate` image applies migrations before the API starts.
  `docker compose --profile app up --build` starts PostgreSQL, storage, migrations, API and web.
- Deploy: `deploy/compose.prod.yaml` (Caddy with automatic TLS, PostgreSQL, migrate, API, web),
  tag-triggered `deploy.yml` (multi-arch images to GHCR, then SSH to the VPS), `scripts/backup.sh`,
  `docs/deploy.md`.
- Fixes from the review of phases 4-5:
  - The private edit link is shown from the first moment, also for drafts.
  - A token that arrives in a link is stored only after the API accepts it, so a truncated link cannot
    replace a working token; the editor also works in a tab when browser storage is blocked.
  - A card cannot be saved while its photo or voice note is still uploading.
  - Text being typed is not replaced by an older value coming back; changes to a gift are applied one at
    a time.
  - The microphone is released when the form closes during a recording.
  - Sheets move focus in, keep it inside and give it back.
  - Plan limits in upgrade texts come from `PLAN_CAPABILITIES`; a failed availability check no longer
    blocks payment.
- Final check, run for real:
  - `docker compose --profile app up --build`: all services healthy, `/health` 200.
  - `scripts/smoke.sh` against that stack: create → publish → server-rendered gift page → delete → 404.
  - `pnpm test:e2e`: free and paid flows in a mobile browser against the built apps.
- Totals: 101 API tests, 77 web tests, 11 contract tests, 2 end-to-end flows.

## What changed from the plan (and why)

- **The Playwright run against the composed stack was replaced by `scripts/smoke.sh`.** The browser tests
  run against the same built apps started as processes; inside containers the browser cannot reach an API
  address that is baked into the bundle as `localhost`.
- **Caddy was added** as the reverse proxy for TLS, which the plan did not name.

## Pending (not blocking)

- The deploy workflow, the production compose file on a real host and the backup script have not been
  executed: they need the VPS and the accounts.
- No real payment was made: Stripe is replaced by a local stand-in in tests.
- Rate limit counters are per API instance (in memory).
- The privacy page is a plain-language notice without the legal identity of the operator; it needs a legal
  notice with your company details before going live.
- Local Node is 24.14; some tools ask for 24.15+ (warnings only). CI and the images use current Node 24.

## What I need from you

- Stripe: test keys to try a real payment; later a live account with the two prices, the webhook endpoint,
  and Apple Pay, Google Pay and Bizum enabled (Bizum needs Stripe's approval).
- Cloudflare R2 bucket with a public domain and an API token.
- Domain, VPS and the repository secrets listed in `docs/deploy.md`.
- Legal notice and controller details for the privacy page.
- Confirmation of the three assumptions in `docs/spec.md` (free gifts can be published; the free reveal is
  an envelope; the QR points to `/for/<slug>`).

## Proposal for the next phase

- First real deploy to a staging host, a real test-mode payment end to end, then: transactional email with
  the edit link, a redirect from old links to the current one, and drag-and-drop reordering.
