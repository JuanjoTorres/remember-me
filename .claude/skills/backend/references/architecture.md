# Architecture

Read this before adding a module, moving code between folders, or touching bootstrap and the request
pipeline.

## Shape

A NestJS modular monolith, ESM (`"type": "module"`, `module: NodeNext`), strict TypeScript. One process
serves everything; the modules are kept independent so that `payments` can be extracted later.

| Folder                          | Holds                                                                   |
| ------------------------------- | ----------------------------------------------------------------------- |
| `apps/api/src/modules/gifts`    | Gifts, cards, slugs, publishing, the public read used by the QR target  |
| `apps/api/src/modules/media`    | Image and audio uploads, object storage, cleanup when a gift is deleted |
| `apps/api/src/modules/qr`       | QR code rendering. Stateless: no table, no events                       |
| `apps/api/src/modules/payments` | Orders, Stripe Checkout, webhook, confirmation. The only user of Stripe |
| `apps/api/src/shared`           | Cross-cutting code every module may import (see below)                  |
| `apps/api/src/config`           | Env validation (`env.ts`) and the global `ENV` provider                 |
| `apps/api/src/health`           | `GET /health`, registered directly in the root module                   |
| `apps/api/src/generated/prisma` | Generated Prisma client. Git-ignored, never edited, never read by hand  |
| `apps/api/prisma`               | `schema.prisma` and the committed migrations                            |
| `apps/api/test`                 | Integration tests through HTTP, the architecture test, harness          |

What `shared/` holds:

- `apps/api/src/shared/auth/`: `GiftGrantService`, `GiftGrantGuard`, the `@Grant()` decorator (global
  `AuthModule`). See `.claude/skills/backend/references/auth-and-security.md`.
- `apps/api/src/shared/events/`: the `EventBus` abstraction, both drivers, and every event contract
  (global `EventsModule`). See `.claude/skills/backend/references/events.md`.
- `apps/api/src/shared/http/`: `AppError`, `AppExceptionFilter`, `ZodPipe`.
- `apps/api/src/shared/prisma/`: `PrismaService` (global `PrismaModule`). All modules share one client and
  one database, but each module only touches its own tables.

A feature module has: `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, plus small helper
files next to them. There are no repository classes; services use `PrismaService` directly.

## Bootstrap

- `apps/api/src/main.ts`: outside production it loads a local env file next to the app if one exists, then
  creates the app with `rawBody: true` (the Stripe webhook needs the raw bytes), calls `configureApp` and
  listens on `PORT` on all interfaces.
- `apps/api/src/bootstrap.ts` (`configureApp`): helmet, `trust proxy`, CORS for `WEB_ORIGIN` only, the
  global `AppExceptionFilter`, shutdown hooks. The integration tests call the same function, so HTTP
  behaviour in tests equals production.
- `apps/api/src/app.module.ts`: imports `ConfigModule`, `ThrottlerModule` (two named throttlers),
  `PrismaModule`, `EventsModule`, `AuthModule`, then the four feature modules. Registers `ThrottlerGuard`
  as `APP_GUARD` and `HealthController`.
- `apps/api/src/config/config.module.ts`: global; provides the `ENV` symbol by calling `loadEnv()` once.
  Inject with `@Inject(ENV) env: Env`.

## Request lifecycle

1. Express + helmet + CORS (`configureApp`).
2. `ThrottlerGuard` (global). Throttler `default` applies to every route; `gift-creation` applies only to
   `POST /gifts` (see `isGiftCreation` in `apps/api/src/app.module.ts`). Health and the webhook skip both
   with `@SkipThrottle`.
3. Route guards: `GiftGrantGuard` on media, QR and the two authenticated payment routes.
4. Pipes, per parameter (there is no global validation pipe): `ZodPipe` with a shared schema for bodies
   and queries, `ParseUUIDPipe` for id params.
5. Controller calls the service. Controllers hold no logic.
6. Errors: `AppExceptionFilter` turns everything into the shared `ApiError` body. `AppError` keeps its code
   and details; a Nest `HttpException` (bad UUID, throttled, file too large) gets the code that
   `codeForStatus` maps from its status; anything else is logged and answered as 500 `INTERNAL` with a
   generic message.

## How the boundary is enforced

`apps/api/test/architecture.test.ts` parses the imports of every `.ts` file under `apps/api/src`:

- the module folders are exactly `gifts`, `media`, `payments`, `qr` (`EXPECTED_MODULES`);
- no file in one module imports a relative path inside another module;
- nothing under `shared/` or `config/` imports from a module;
- only files in `modules/payments` import `stripe`.

It only sees relative imports, so do not try to get around it with path aliases or re-exports through
`shared/`: the rule is the one in `CLAUDE.md`, the test is just its guard.

## Adding a module

Ask first: `CLAUDE.md` fixes the list of modules. If the user agrees:

1. Create `apps/api/src/modules/<name>/` with module, controller and service; import it in
   `apps/api/src/app.module.ts`.
2. Add the name to `EXPECTED_MODULES` in `apps/api/test/architecture.test.ts`.
3. Give it its own tables (no relation to tables of other modules) and talk to others through events.
4. If it needs gift facts, protect its endpoints with `GiftGrantGuard` and read the claims.

## Mail and scheduled jobs

- `apps/api/src/shared/mail/mailer.ts` defines the abstract `Mailer` (`send`, and `delivers`, false when
  messages go nowhere). `apps/api/src/shared/mail/mail.module.ts` is global and picks the driver from
  `MAIL_DRIVER`: `apps/api/src/shared/mail/log-mailer.ts` (logs the subject, never the address) or
  `apps/api/src/shared/mail/resend-mailer.ts` (Resend HTTP API through `fetch`, no SDK). Inject `Mailer`,
  never a driver. Tests override the provider with a recording fake.
- `ScheduleModule.forRoot()` (`@nestjs/schedule`) is imported in `apps/api/src/app.module.ts`. A scheduled
  job lives in the module that owns the data, in a `*.cron.ts` class that only schedules and logs; the
  work goes in a service that takes `now` as a parameter so tests can call it directly. Jobs run on every
  API instance, so they must be safe to run concurrently (see
  `.claude/skills/backend/references/gifts.md`).

## Decisions

None recorded yet.

## Change checklist

- New or moved file: relative imports end in `.js`; no import crosses a module boundary.
- New module: `apps/api/src/app.module.ts`, `apps/api/test/architecture.test.ts`, a test file under
  `apps/api/test`, the module table above, the rules in `.claude/skills/backend/SKILL.md`, and `CLAUDE.md`
  (with the user's agreement).
- Pipeline change (filter, guard, throttler, helmet, CORS): update this file and
  `.claude/skills/backend/references/auth-and-security.md`; cover it in `apps/api/test/rate-limit.test.ts`
  or the relevant module test.
- New endpoint: `.claude/skills/backend/references/endpoints.md`.
