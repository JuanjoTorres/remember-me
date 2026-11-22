---
name: remember-me
description: How to change remember.me (NestJS API, Next.js web, shared Zod contracts). Load before adding or changing an endpoint, a module, an event, a contract or a feature in this repo.
---

# remember.me

Read `CLAUDE.md` first: its architecture rules win over anything here. Each kind of change below points at
a real file to copy the shape from. Do not paste code from this skill; open the model file.

## Before you finish

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test` (tests need Docker).

## Add or change an API contract

- Schemas and types live in `packages/shared-types/src/`, exported from `index.ts`. Types come from
  `z.infer`, never written by hand. Model: `packages/shared-types/src/gifts.ts`.
- Plan limits are only in `PLAN_CAPABILITIES` (`plans.ts`). Never compare against a literal limit elsewhere.
- Rebuild the package (`pnpm --filter @remember-me/shared-types build`) before the apps see the change.

## Add an endpoint to a module

- Model: `apps/api/src/modules/gifts/gifts.controller.ts` + `gifts.service.ts`.
- Validate every body/query with `new ZodPipe(Schema)` using a shared contract.
- Fail with `AppError(code, message, details)` (`apps/api/src/shared/http/app-error.ts`); add new codes to
  `ErrorCodeSchema` in shared-types and to the status map.
- Editor endpoints of `gifts` take the edit token (`x-edit-token`). Endpoints of other modules take a gift
  grant: `@UseGuards(GiftGrantGuard)` and `@Grant()` (`apps/api/src/shared/auth/`).
- Test through HTTP against the real database. Model: `apps/api/test/gifts.test.ts`, helpers in
  `apps/api/test/helpers.ts`.

## Make modules talk to each other

- They do not import each other (`apps/api/test/architecture.test.ts` fails the build).
- Define the event in `apps/api/src/shared/events/contracts.ts`, publish with `EventBus.publish`, subscribe
  in an `OnModuleInit` provider. Model: `apps/api/src/modules/gifts/payment-succeeded.subscriber.ts`.
- Handlers must be idempotent: delivery is at least once.
- If a module needs a fact about a gift (plan, slug), read it from the grant claims, not from `gifts`.

## Change the database

- Edit `apps/api/prisma/schema.prisma`, then `pnpm --filter api migrate:dev --name <change>` with
  `docker compose up -d postgres` running. Commit the migration.
- `payment_orders` never gets a relation to `gifts`: `giftId` stays a plain string.

## Add an environment variable

- Add it to the Zod schema in `src/config/env.ts` of the app, to its `.env.example`, to `test/setup.ts`
  (api) or `vitest.config.ts` (web), and to `compose.yaml`.
