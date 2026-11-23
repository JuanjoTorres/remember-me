# kardoo.me

Interactive digital gifts behind a QR code. The creator builds a story of photos, messages, voice notes
and an optional trivia question; the recipient scans the code, swipes through it and reveals the surprise.

The public brand is kardoo.me; it is written once, in `apps/web/src/features/shared/brand.ts`. The
repository and the package scope (`@remember-me/*`) keep the project's first name.

## Layout

- `apps/web`: Next.js app. Editor under `/create`, recipient experience under `/for/[slug]`.
- `apps/api`: NestJS modular monolith (`gifts`, `media`, `qr`, `payments`) on PostgreSQL.
- `packages/shared-types`: Zod contracts shared by both, including the plan limits.
- `docs/`: spec, plan, ADRs, phase summaries, research, dependency register.
- `deploy/`: production compose file, Caddy configuration and environment template.

## Requirements

Node 24, pnpm 12 (`corepack enable`), Docker.

## Run locally

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
docker compose up -d postgres storage
pnpm --filter api migrate:deploy
pnpm dev
```

Web on http://localhost:3000, API on http://localhost:4000 (`GET /health`).

Payments need Stripe test settings in `apps/api/.env`: a secret key, two one-time EUR prices (full
experience, custom link) and the webhook secret printed by:

```bash
stripe listen --forward-to localhost:4000/payments/webhook
```

Cards, Apple Pay, Google Pay and Bizum are enabled in the Stripe Dashboard, not in code.

## Run everything from the Docker images

```bash
docker compose --profile app up --build
```

```bash
./scripts/smoke.sh
```

## Checks

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

`pnpm test` needs Docker: the API tests start real PostgreSQL, Redis and S3-compatible storage with
Testcontainers.

End-to-end tests (real browser, built apps, a local stand-in for Stripe):

```bash
pnpm build && pnpm test:e2e
```

## Deploy

One VPS with Docker, images from GHCR, media in Cloudflare R2. See `docs/deploy.md`.
