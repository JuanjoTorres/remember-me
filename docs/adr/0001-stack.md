# ADR 0001: Stack

Date: 2026-11-22 · Status: proposed (pending approval of spec and plan)

## Context

The `new-app` process defaults to .NET + Angular. The project `CLAUDE.md` overrides the stack, and project
rules take precedence over skill defaults.

## Decision

- **Monorepo:** pnpm workspaces + Turborepo. `apps/web`, `apps/api`, `packages/shared-types`.
- **Frontend:** Next.js (App Router), strict TypeScript, Tailwind CSS, Framer Motion, TanStack Query,
  canvas-confetti, next-intl (es + en).
- **Backend:** NestJS modular monolith (`gifts`, `media`, `qr`, `payments`), Prisma on PostgreSQL.
- **Contracts:** Zod schemas in `packages/shared-types`, types through `z.infer`. This replaces the
  OpenAPI-generated client of the skill defaults: front and back share the same schemas at compile time.
- **Events:** `EventBus` interface, in-memory driver on `@nestjs/event-emitter`, Redis driver behind
  `EVENT_BUS_DRIVER=memory|redis`. `payments` talks to the rest only through it.
- **Storage:** S3-compatible (Cloudflare R2 in production, MinIO in local compose). Images converted to WebP
  with sharp.
- **Payments:** Stripe Checkout, one-time payment, dynamic payment methods.
- **Testing:** Vitest (unit + integration against a real PostgreSQL container), an architecture test that
  enforces module boundaries, Playwright smoke test for the main flow.
- **Quality gates:** ESLint, Prettier check, `pnpm typecheck`, `pnpm build`, tests. Same gates in CI.
- **Deployment:** one Dockerfile per app, `compose.yaml` for local and VPS. No Kubernetes manifests in v1;
  the images are independent so they can run as separate pods later.
- **Versions:** latest stable of each package as recorded in `docs/research/versions-and-stripe.md`.
  Prisma stays on 7.10.x (8 is a release candidate). TypeScript 7 is used if every tool supports it,
  otherwise the latest 6.x.

## Consequences

- The skill defaults that are .NET-specific (ArchUnitNET, Quartz, Spectral/oasdiff) are replaced by their
  closest equivalent or dropped: module-boundary test, no background scheduler in v1, Zod contracts.
- No foreign key between `payment_orders` and `gifts`: consistency between them is eventual and relies on
  idempotent event handling.
