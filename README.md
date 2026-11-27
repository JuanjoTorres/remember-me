# kardoo.me

Interactive digital gifts behind a QR code. The creator builds a story of photos, messages, voice notes
and an optional trivia question; the recipient scans the code, swipes through it and reveals the surprise.

The public brand is kardoo.me; it is written once, in `apps/web/src/features/shared/brand.ts`. The
repository and the package scope (`@remember-me/*`) keep the project's first name.

## Layout

- `apps/web`: Next.js app. Editor under `/create`, recipient experience at the gift's link (`/[code]`, or `/[code]/for/[name]` for a custom link).
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
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to localhost:4000/payments/webhook
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
pnpm format:check && pnpm check:docs && pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

A change made only of Markdown documentation needs just `pnpm format:check && pnpm check:docs`.
A code change is reviewed in full (`CLAUDE.md` section 7): everything at once, with the tests
three times over and the browser flows, is `pnpm verify`. For a
change to a Dockerfile, `.dockerignore`, a compose file, the Caddy configuration or anything else
that ends up in the images, also `pnpm verify:infra` (builds the images, starts the stack from
them, runs the smoke test).

`pnpm build` needs `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` in the shell (for example
`http://localhost:4000`).

`pnpm test` needs Docker: the API tests start real PostgreSQL, Redis and S3-compatible storage with
Testcontainers.

End-to-end tests (real browser, built apps, a local stand-in for Stripe):

```bash
pnpm build && pnpm test:e2e
```

## Deploy

One VPS with Docker, images from GHCR, media in Cloudflare R2. Staging runs at
https://staging.kardoo.me and is deployed on every merge to `main`. See `docs/deploy.md`.

## Working on this repository with Claude Code

`.claude/skills/` holds one skill per area (`backend`, `frontend`, `ops`). Each `SKILL.md` lists the
rules of the area and points to one reference per kind of change, so that only the relevant
document is read. A hook (`.claude/hooks/skill-gate.mjs`) refuses edits in an area until its skill
has been loaded in the session. The references are living documents: a change that alters what
they describe updates them in the same commit, and `pnpm check:docs` fails when a skill or an agent definition names
a file that no longer exists.
