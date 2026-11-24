---
name: backend
description: Must be loaded before adding or changing anything in apps/api or packages/shared-types (endpoint, module, event, contract, database schema, env var, test). Routes to one reference per kind of change.
---

# Backend (apps/api + packages/shared-types)

`CLAUDE.md` wins over anything here. This file only routes: read the rules, then open the ONE reference
that matches your change. Do not load the others unless that reference sends you there.

## Rules that never bend

- Modules are `gifts`, `media`, `qr`, `payments` under `apps/api/src/modules`. A module never imports from
  another module; `shared/` and `config/` never import from a module. `apps/api/test/architecture.test.ts`
  fails otherwise, and also fails if a module folder is added or removed without updating it.
- Modules talk only through `EventBus` events defined in `apps/api/src/shared/events/contracts.ts`.
  Delivery is at least once: every handler must be idempotent.
- `payments` is isolated: no relation and no foreign key from `payment_orders` or `payment_webhook_logs`
  to any other table (`giftId` is a plain string). A test in `apps/api/test/payments.test.ts` checks it.
- Only files inside `apps/api/src/modules/payments` import `stripe`. Everything goes through
  `PaymentGateway`.
- Never send a payment method list to Stripe Checkout. Never write an amount or a currency in code: prices
  are Stripe Price IDs from the env, amounts are read from Stripe.
- Webhooks are idempotent through `payment_webhook_logs`: `processedAt` is set only after full handling.
- Plan limits exist only in `PLAN_CAPABILITIES` and the `check*` helpers of
  `packages/shared-types/src/plans.ts`. Never compare against a literal limit anywhere else.
- A module that needs a fact about a gift (id, slug, plan, published) reads it from the gift grant claims,
  never from the `gifts` tables or service.
- Request and response shapes are Zod schemas in `packages/shared-types`; types come from `z.infer`.
  Bodies and queries are validated with `ZodPipe`. Expected failures are `AppError` with a shared code.
- Env vars are read only through the validated `Env` object (`apps/api/src/config/env.ts`), never from
  `process.env` in application code.
- ESM everywhere: relative imports end in `.js`. Use `pnpm`, never npm or yarn. Never open a real env
  file; only `apps/api/.env.example`.

## You are about to… → read

| Change                                                               | Reference                         |
| -------------------------------------------------------------------- | --------------------------------- |
| Add a module, move code, touch bootstrap or the request pipeline     | `references/architecture.md`      |
| Add, change or remove an HTTP endpoint                               | `references/endpoints.md`         |
| Add or change a schema, error code, plan capability or slug rule     | `references/contracts.md`         |
| Change gift lifecycle, cards, publishing, slugs, applying a payment  | `references/gifts.md`             |
| Change uploads, storage or QR codes                                  | `references/media-qr.md`          |
| Touch checkout, orders, the webhook, confirmation or Stripe          | `references/payments.md`          |
| Add an event, a subscriber, or touch the event bus drivers           | `references/events.md`            |
| Change edit tokens, grants, rate limits, CORS, headers, proxy trust  | `references/auth-and-security.md` |
| Add or change a table, column, index or migration                    | `references/database.md`          |
| Add or change an environment variable                                | `references/config-env.md`        |
| Write or fix a test, or a test fails and you do not know the harness | `references/testing.md`           |

## Living documents

These files are part of the code.

- Any change that adds, removes or renames an endpoint, event, table or column, env var, error code,
  contract, module, or a rule described here must update the matching reference in the same commit.
- When the user states "this is how we do X", record it in the matching reference under its "Decisions"
  heading, with the date.
- If a reference contradicts the code, the code wins: fix the reference in the same change.
- Each reference ends with a "Change checklist". Follow it.

## Before you finish

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`. Tests need Docker. The
  build needs `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` set (for example `http://localhost:4000`).
- `pnpm check:docs` (verifies the paths named in these documents).
- Never weaken or delete a test to make it pass.

Then, for any code change, the mandatory review of `CLAUDE.md` section 7: a fresh `reviewer` agent (`.claude/agents/reviewer.md`) reviews
the change and runs `pnpm verify` (everything above, the tests three times, the browser flows). A test
that fails once is a failure to explain, never something to re-run until it passes.

A change made only of Markdown (`docs/**`, `README.md`, `CLAUDE.md`, `.claude/skills/**`,
`.claude/agents/**`) needs only `pnpm format:check && pnpm check:docs`: no `pnpm verify` and no
reviewer.
