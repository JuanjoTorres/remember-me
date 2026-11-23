# Phase 0: Research and skeleton (2026-11-22)

## Done

- pnpm 12 + Turborepo monorepo: `apps/web` (Next.js 16), `apps/api` (NestJS 12, ESM, Prisma 7),
  `packages/shared-types` (Zod 4).
- Strict TypeScript everywhere, ESLint, Prettier, Vitest.
- Env validation with Zod in `src/config/env.ts` of both apps; the API refuses to start with an invalid env,
  the web validates from `instrumentation.ts` and at build time for `NEXT_PUBLIC_*`.
- `GET /health` (checks the database), tested against a real PostgreSQL through Testcontainers.
- Architecture test (`apps/api/test/architecture.test.ts`): modules cannot import each other, shared code
  cannot import modules, only `payments` may import Stripe.
- Lint rule that blocks `gift-creator`, `checkout` and Stripe imports on the recipient path.
- es/en UI with next-intl (cookie, then `Accept-Language`), landing page.
- Dockerfiles for both apps, `compose.yaml` (PostgreSQL), CI workflow, `.env.example` files.
- Ran it: `/health` answered 200 with the database up, the API exited with a clear error without
  `DATABASE_URL`, the built web served the landing page in Spanish.

## What changed from the plan (and why)

- **TypeScript 6.0.3 instead of 7:** `typescript-eslint` does not support 7 yet.
- **The API is ESM:** NestJS 12 ships as ES modules.
- **`compose.yaml` only has PostgreSQL for now.** Object storage is added in Phase 2 and the app services in
  Phase 6, when the Docker images are built and verified. The Dockerfiles are written but not built yet.
- **No separate review for this phase:** it is reviewed together with Phase 1.

## Pending (not blocking)

- Local Node is 24.14; some dev tools (jsdom, Nest schematics) ask for 24.15+. They work, with warnings.

## What I need from you

- Nothing.

## Proposal for the next phase

- Phase 1 as planned: contracts, gifts module with plan limits, event bus.
