# remember.me

Interactive digital gifts behind a QR code. The creator builds a story of photos, messages, voice notes
and an optional trivia question; the recipient scans the code, swipes through it and reveals the surprise.

## Layout

- `apps/web`: Next.js app (editor, checkout, recipient experience under `/for/[slug]`).
- `apps/api`: NestJS modular monolith (`gifts`, `media`, `qr`, `payments`) on PostgreSQL.
- `packages/shared-types`: Zod contracts shared by both.
- `docs/`: spec, plan, ADRs, phase summaries, research.

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

## Checks

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

`pnpm test` needs Docker: the API integration tests start a real PostgreSQL with Testcontainers.
