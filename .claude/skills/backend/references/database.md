# Database

Read this before adding or changing a table, column, index, enum or migration.

PostgreSQL through Prisma. One database, one schema file: `apps/api/prisma/schema.prisma`. Tables and
columns are snake_case (`@@map`, `@map`); model fields are camelCase.

## Ownership

Each table belongs to one module and only that module reads or writes it.

| Table                  | Model               | Owner    |
| ---------------------- | ------------------- | -------- |
| `gifts`                | `Gift`              | gifts    |
| `gift_cards`           | `GiftCard`          | gifts    |
| `gift_slug_aliases`    | `GiftSlugAlias`     | gifts    |
| `media_assets`         | `MediaAsset`        | media    |
| `payment_orders`       | `PaymentOrder`      | payments |
| `payment_webhook_logs` | `PaymentWebhookLog` | payments |

## The no-FK rule

Relations (`@relation`) and foreign keys exist only between tables of the same module: `gift_cards` and
`gift_slug_aliases` reference `gifts` with `ON DELETE CASCADE`. `media_assets.gift_id` and
`payment_orders.gift_id` are plain values with an index and no constraint. For payments this is a hard
rule from `CLAUDE.md` (future extraction); a test in `apps/api/test/payments.test.ts` reads the catalog and
fails on any foreign key touching a `payment_` table. Never add a relation field across modules, even
"just for an include".

## Tables

### `gifts`

- `id` UUID primary key. `slug` unique.
- `slug_is_custom`: the creator chose the slug; generated slugs may be replaced on first publication.
- `custom_slug_pending`: a custom link was paid for but could not be applied; the creator may pick one.
- `edit_token_hash`: SHA-256 of the edit token. The token is never stored.
- `status` (`GiftStatus`: `DRAFT`, `PUBLISHED`), `published_at`.
- `is_premium`: the plan. There is no plan column; `planOf` derives it.
- `applied_order_ids`: text array of payment order ids already applied. Plain values, no relation. This is
  the idempotency record of `applyPayment`.
- `locale` (text, default `en`), `recipient_name`, `sender_name`.
- Reveal as columns: `reveal_template` (`RevealTemplate` enum), `reveal_headline`, `reveal_message`,
  `reveal_detail`, `reveal_image_url` (nullable).
- `created_at`, `updated_at`.

### `gift_cards`

- `id` UUID, `gift_id` UUID (FK, cascade), `position` int, `type` (`CardType` enum).
- `payload` JSONB: shape depends on `type`, validated with the shared Zod contracts on write and read.
- Index on (`gift_id`, `position`). Positions are not unique in the database.

### `gift_slug_aliases`

- `slug` primary key, `gift_id` UUID (FK, cascade), index on `gift_id`.
- Former links of a published gift, kept so old QR codes still resolve.

### `media_assets`

- `id` UUID, `gift_id` UUID (no FK, indexed), `kind` (`MediaKind`: `IMAGE`, `AUDIO`), `storage_key`
  unique, `content_type`, `bytes`, `created_at`.
- One row per stored object. Rows are counted for the per-gift ceiling and drive cleanup.

### `payment_orders`

- `id` UUID. `gift_id` is TEXT (not UUID), no FK, indexed.
- `status` (`PaymentOrderStatus`: `PENDING`, `PAID`, `EXPIRED`, `REFUND_DUE`).
- `stripe_session_id` unique, nullable (set after the session is created). `checkout_url` nullable, used
  to hand out the same open session again.
- `include_custom_slug`, `custom_slug`: what was ordered.
- `amount_total` (smallest currency unit) and `currency`: as reported by Stripe when paid.
- `created_at`, `paid_at`.

### `payment_webhook_logs`

- `event_id` primary key (the Stripe event id), `type`, `received_at`, `processed_at` (nullable; set only
  when the event was fully handled).

## Migrations

Committed under `apps/api/prisma/migrations`, in order:

| Folder                                 | Adds                                                           |
| -------------------------------------- | -------------------------------------------------------------- |
| `20261122230003_gifts`                 | `gifts`, `gift_cards`, their enums                             |
| `20261122230713_media_assets`          | `media_assets`, `MediaKind`                                    |
| `20261122231357_payments`              | `payment_orders`, `payment_webhook_logs`, `PaymentOrderStatus` |
| `20261122231508_gift_links_and_orders` | `gifts.applied_order_ids`, `gift_slug_aliases`                 |
| `20261122232257_payment_refund_due`    | enum value `REFUND_DUE`, `payment_orders.checkout_url`         |

To create one:

1. Edit `apps/api/prisma/schema.prisma`.
2. With the local database up (`docker compose up -d postgres`), run
   `pnpm --filter api migrate:dev --name <change>`.
3. Read the generated SQL. Check it adds no foreign key across modules and is safe on existing rows (new
   non-null columns need a default).
4. Commit the migration folder. Never edit or delete a migration that was already committed.

Where migrations get applied: the test global setup runs `prisma migrate deploy` on a fresh container;
deployments run the `migrate` target of `apps/api/Dockerfile` before the API starts
(`pnpm --filter api migrate:deploy` does the same by hand).

## Prisma 7 specifics used here

- Generator `prisma-client` with `output` set to `apps/api/src/generated/prisma`, ESM, `.js` import
  suffixes. Import types and `Prisma` from that folder's `client.js`, never from `@prisma/client`.
- The generated client is git-ignored and excluded from lint and format. `prisma generate` runs
  automatically before `build`, `typecheck` and `test` (the `pre*` scripts in `apps/api/package.json`).
- The `datasource` block has no URL. The CLI reads `DATABASE_URL` through `apps/api/prisma.config.ts`,
  which also loads a local env file if present.
- At runtime `PrismaService` (`apps/api/src/shared/prisma/prisma.service.ts`) extends the generated client
  with the `PrismaPg` driver adapter and the validated `DATABASE_URL`.
- Raw SQL in use: row lock on a gift (`GiftsService.lock`), advisory transaction locks per gift
  (`MediaService.upload`, `PaymentsService.createCheckoutSession`), health probe. Raw SQL uses table and
  column names, so a rename must update it by hand.
- Unique violations are detected by Prisma error code `P2002` (`isUniqueViolation` in
  `apps/api/src/modules/gifts/gifts.service.ts`).

## Decisions

None recorded yet.

## Change checklist

- `apps/api/prisma/schema.prisma` plus one new folder under `apps/api/prisma/migrations`.
- An enum mirrored in contracts (`GiftStatus`, `CardType`, `RevealTemplate`, `MediaKind`): the matching
  schema in `packages/shared-types/src/`.
- Mapper or service that reads the column; raw SQL that names it.
- Tests of the owning module; they run against a real PostgreSQL with all migrations applied.
- Update the table sections and the migrations list in this file.
