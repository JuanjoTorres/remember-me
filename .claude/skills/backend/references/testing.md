# Testing

Read this before writing or fixing a backend test, or when a test fails and you need to know the harness.

Rule: never weaken, skip or delete a test to make it pass. If a test fails, the code is wrong or the
behaviour changed on purpose; in the second case change the test to assert the new behaviour and say so.

## How tests run

- Runner: Vitest. API config in `apps/api/vitest.config.ts`: SWC plugin (Nest decorators need emitted
  metadata), test files are every file ending in ".test.ts" under the `src` and `test` folders of the app, no file parallelism (files
  share one database), generous hook timeout for container start.
- `pnpm test` runs every package through Turborepo, after building `packages/shared-types`. One package:
  `pnpm --filter api test`; one file: append `exec vitest run` and the file path relative to the app folder.
- Docker must be running. Nothing else has to be started by hand.
- `apps/api/test/global-setup.ts` starts, once per run, a PostgreSQL container (`postgres:17-alpine`) and
  an S3-compatible container (Adobe S3Mock, image and tag in that file) with the bucket `TEST_BUCKET`, applies the committed
  migrations with `prisma migrate deploy`, and provides the connection values to the test files.
- `apps/api/test/setup.ts` runs before each file and sets the whole environment (`NODE_ENV=test`, memory
  event bus, test Stripe values, very high rate limits and link-guess budgets). A new required env var must be added there.
- The database is not reset between tests or files. Every test creates its own gift and asserts only on
  its own data. Never assert on global counts.
- Stripe is never contacted: see "How tests fake Stripe" in
  `.claude/skills/backend/references/payments.md`.

## Test files

| File                                                  | Covers                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/architecture.test.ts`                  | Module list, no cross-module imports, shared and config independent, Stripe only in payments                                                                                                                                                                                      |
| `apps/api/test/gifts.test.ts`                         | Creation and edit access, drafts without plan limits, the paywall at publication, plan limits of published gifts (also concurrent), cards, publishing, public view, payment events applied to gifts, links and their availability, locking after delivery, expiry dates, deletion |
| `apps/api/test/gift-lifecycle-cron.test.ts`           | The schedule class: runs the clean-up, does nothing with `SCHEDULED_JOBS=off`, survives a failing job, schedules no anniversary email                                                                                                                                             |
| `apps/api/test/gift-lifecycle.test.ts`                | Deletion of expired gifts with their files (also a failing storage), the anniversary email (once, concurrent runs, failure, escaping, no delivery configured)                                                                                                                     |
| `apps/api/test/media-qr.test.ts`                      | Image and audio uploads against real storage, content sniffing, storage ceiling, cleanup on deletion, QR per plan (decodes the PNG)                                                                                                                                               |
| `apps/api/test/payments.test.ts`                      | Prices cache, checkout session creation and reuse, webhook signature and idempotency, delayed methods, refunds due, confirm, no foreign keys                                                                                                                                      |
| `apps/api/test/event-bus.test.ts`                     | One contract suite run against both drivers, plus driver-specific delivery. Starts its own Redis container (`redis:8-alpine`)                                                                                                                                                     |
| `apps/api/test/link-privacy.test.ts`                  | Generated links are long random codes, no reuse of another gift's old link (the generator is mocked to force the collision), the miss budget of the public lookup and the budget of the availability check, per visitor                                                           |
| `apps/api/test/rate-limit.test.ts`                    | Both throttlers with low limits, exemptions, hardening headers                                                                                                                                                                                                                    |
| `apps/api/test/health.test.ts`                        | Health endpoint                                                                                                                                                                                                                                                                   |
| `apps/api/src/config/env.test.ts`                     | Env schema: defaults, each rule, each environment restriction                                                                                                                                                                                                                     |
| `apps/api/src/shared/http/attempt-limiter.test.ts`    | `AttemptLimiter`: blocking, window end, memory ceiling                                                                                                                                                                                                                            |
| `apps/api/src/shared/auth/gift-grant.service.test.ts` | Grant round trip, expiry, tampering                                                                                                                                                                                                                                               |
| `packages/shared-types/src/gifts.test.ts`             | Card payload contracts, link rules and codes, lifecycle dates                                                                                                                                                                                                                     |
| `packages/shared-types/src/plans.test.ts`             | Plan checks                                                                                                                                                                                                                                                                       |

Unit tests sit next to the source (`*.test.ts` under `src`); they are excluded from the build by
`apps/api/tsconfig.build.json`. Everything with HTTP or the database goes under `apps/api/test`.

## Time in tests

Nothing waits for real time. A test moves a gift into the past by writing `publishedAt` or `expiresAt`
through `PrismaService`, and the lifecycle jobs take `now` as an argument. The lifecycle tests delete
every expired gift in the shared database; that is safe only because files run one after another.

## Helpers

- `apps/api/test/create-test-app.ts`: `createTestApp(customize?)` boots the real `AppModule` with
  `rawBody` and `configureApp`, exactly like production. `customize` receives the testing module builder
  for `overrideProvider` (used to swap `STRIPE_CLIENT`, and `Mailer` for a recording fake in
  `apps/api/test/gift-lifecycle.test.ts`).
- `apps/api/test/helpers.ts`:
  - `createGift(app)`: `POST /gifts`, returns the gift view and the edit token.
  - `editor(app, giftId, editToken)`: a client with one method per editor endpoint.
  - `photoCard(text?)`: a valid FREE card.
  - `mediaUrl(giftId, fileName)`: a URL that passes the media URL policy.
  - `makePremium(app, giftId)`: sets `isPremium` in the database, for tests not about payment.
- Local to their files: `readyGift`, `startCheckout`, `paidEvent`, `deliver` (payments); `setup`,
  `upload`, the binary fixtures (media and QR); `publishedGift`, `pay` (gifts).

## Writing an HTTP test

1. Put it in the test file of the module, inside the matching `describe`. Reuse that file's `app`.
2. Arrange through the API (`createGift`, `editor`), not with direct inserts. Reach into
   `app.get(PrismaService)` only to set up a state the API cannot produce or to assert on stored data.
3. Call with `supertest` on `app.getHttpServer()`. Send the edit token or
   `Authorization: Bearer <grant>`; take the grant from a fresh `GET` of the gift, since plan and
   published state are baked into it.
4. Assert the status, then parse the body with the shared schema (`GiftEditorViewSchema.parse`,
   `ApiErrorSchema.parse`) so contract drift fails the test. For errors assert `code` and the relevant
   `details`.
5. Cover: the success path, each auth failure, each documented error, and repetition or concurrency when
   the code has a lock or an idempotency guard (model: "does not let concurrent requests slip past the
   card limit").
6. To exercise an event handler directly, publish on `app.get(EventBus)`. To observe a publish, subscribe
   with a test subscriber name.
7. Failures of a dependency are simulated with `vi.spyOn` on the injected provider (model: the storage
   failures in `apps/api/test/media-qr.test.ts`); time with `vi.spyOn(Date, 'now')`. Restore spies.
8. Do not override env values in a shared file. If a test needs different env, give it its own file that
   sets the values before `createTestApp` and restores them after (model:
   `apps/api/test/rate-limit.test.ts`).
9. Take limits from the shared constants (`PLAN_CAPABILITIES`, `MEDIA_LIMITS`, `MAX_ASSETS_PER_GIFT`,
   `SESSION_CHECK_INTERVAL_MS`) where the test is about the mechanism rather than the number.

## Decisions

None recorded yet.

## Change checklist

- New behaviour: a test in the module's file; new module: a new file under `apps/api/test`.
- New editor endpoint: a method on `editor` in `apps/api/test/helpers.ts`.
- New external dependency: a real container in `apps/api/test/global-setup.ts` or a local stand-in; never
  the real service, never a mock of our own module.
- New required env var: `apps/api/test/setup.ts`.
- Update the file table here when a test file is added, removed or changes scope.
- Before finishing: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
