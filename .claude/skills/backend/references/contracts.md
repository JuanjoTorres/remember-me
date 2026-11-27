# Contracts (packages/shared-types)

Read this before adding or changing a request or response schema, an error code, a plan capability or a
slug rule.

## What the package is

`@remember-me/shared-types` holds the Zod schemas shared by `apps/api` and `apps/web`. Types are always
`z.infer` of a schema, never written by hand. It is ESM, built with `tsc` to `dist/`, and both apps
consume the built output (`workspace:*`). Turborepo builds it before any app task (`dependsOn: ^build` in
`turbo.json`); when running a single app command by hand, rebuild it first:
`pnpm --filter @remember-me/shared-types build`.

Everything is re-exported from `packages/shared-types/src/index.ts`. A new file must be added there.

## Files

| File                                     | Exports                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/plans.ts`     | `PlanSchema`, `CardTypeSchema`, `RevealTemplateSchema`, `QrFormatSchema`, `PlanCapabilitiesSchema`, `PLAN_CAPABILITIES`, `MAX_CARDS_HARD_LIMIT`, `planOf`, `PremiumCapabilitySchema`, `PlanCheck`, `checkAddCard`, `checkRevealTemplate`, `checkQrFormat`, `ProFeatureSchema`, `proFeaturesOf`                                                  |
| `packages/shared-types/src/gifts.ts`     | `LocaleSchema`, `GiftStatusSchema`, `CARD_TEXT_MAX`, the three card payload schemas, `CardInputSchema`, `CardSchema`, `ReorderCardsRequestSchema`, `RevealSchema`, `CreateGiftRequestSchema`, `UpdateGiftRequestSchema`, `ChangeSlugRequestSchema`, `GiftEditorViewSchema`, `CreateGiftResponseSchema`, `PublicGiftSchema`, `EDIT_TOKEN_HEADER` |
| `packages/shared-types/src/slug.ts`      | `SLUG_MIN_LENGTH`, `SLUG_MAX_LENGTH`, `RESERVED_SLUGS`, `SlugSchema`, `CustomSlugSchema`, `slugify`, `SlugAvailabilitySchema`, `GENERATED_SLUG_SUFFIX_LENGTH`, `SLUG_SUFFIX_LENGTH`, `SLUG_SUFFIX_MIN_LENGTH`, `randomSlugSuffix`, `SlugSuffixSchema`, `splitSlug`, `joinSlug`, `SLUG_SUGGESTION_COUNT`                                         |
| `packages/shared-types/src/media.ts`     | `MediaKindSchema`, `MediaUploadResponseSchema`, `MEDIA_LIMITS`                                                                                                                                                                                                                                                                                  |
| `packages/shared-types/src/payments.ts`  | `CheckoutSessionRequestSchema`, `CheckoutSessionResponseSchema`, `PriceSchema`, `PricesResponseSchema`, `PaymentConfirmationSchema`                                                                                                                                                                                                             |
| `packages/shared-types/src/errors.ts`    | `ErrorCodeSchema`, `PremiumRequiredDetailsSchema`, `GiftLockedDetailsSchema`, `ApiErrorSchema`                                                                                                                                                                                                                                                  |
| `packages/shared-types/src/lifecycle.ts` | `DRAFT_TTL_DAYS`, `FREE_GIFT_TTL_YEARS`, `EDIT_GRACE_HOURS`, `ANNIVERSARY_YEARS`, `addYears`, `draftExpiry`, `freeGiftExpiry`, `editableUntil`                                                                                                                                                                                                  |
| `packages/shared-types/src/health.ts`    | `HealthResponseSchema`                                                                                                                                                                                                                                                                                                                          |

Tests: `packages/shared-types/src/gifts.test.ts` (card payloads, slugs, lifecycle dates) and
`packages/shared-types/src/plans.test.ts` (plan checks, `proFeaturesOf`).

## Error codes

`ErrorCodeSchema` lists the codes; `STATUS_BY_CODE` in `apps/api/src/shared/http/app-error.ts` maps each to
an HTTP status. It is a `Record<ErrorCode, number>`, so a code without a status does not compile.

| Code                | Status | Used for                                                                     |
| ------------------- | ------ | ---------------------------------------------------------------------------- |
| `VALIDATION_ERROR`  | 400    | `ZodPipe` failures (details: list of `path`, `message`), domain input errors |
| `UNAUTHORIZED`      | 401    | Edit token, gift grant, webhook signature                                    |
| `PREMIUM_REQUIRED`  | 402    | A plan check failed; details follow `PremiumRequiredDetailsSchema`           |
| `NOT_FOUND`         | 404    | Unknown gift, card or public slug                                            |
| `CONFLICT`          | 409    | Hard ceilings, already paid, QR of an unpublished gift                       |
| `SLUG_TAKEN`        | 409    | Custom link in use                                                           |
| `PAYLOAD_TOO_LARGE` | 413    | Upload over the size limit (raised by the file interceptor)                  |
| `UNSUPPORTED_MEDIA` | 415    | File content is not an accepted image or audio format                        |
| `GIFT_INCOMPLETE`   | 422    | Publish requirements; details `{ missing: [...] }`                           |
| `GIFT_LOCKED`       | 423    | Edit of a delivered gift; details follow `GiftLockedDetailsSchema`           |
| `RATE_LIMITED`      | 429    | Throttler                                                                    |
| `INTERNAL`          | 500    | Anything unexpected                                                          |

`codeForStatus` does the reverse lookup for Nest `HttpException`s and returns the first code with that
status; for 409 that is `CONFLICT`. Keep that in mind before adding a second code on an existing status.

## Plan capabilities

`PLAN_CAPABILITIES` is the single source of truth for `FREE` and `PREMIUM`: `maxCards` (`null` = no plan
limit), `cardTypes`, `revealTemplates`, `watermark`, `qrFormats`, `qrPngSize`. Read the values there; do
not repeat them in code, tests of other packages, or messages.

- The API enforces them through `checkAddCard`, `checkRevealTemplate`, `checkQrFormat`, and direct reads
  of `PLAN_CAPABILITIES` in `apps/api/src/modules/media/media.service.ts` (audio) and
  `apps/api/src/modules/gifts/gift.mapper.ts` (watermark, and the `capabilities` sent to the editor).
- A failed check returns `{ allowed: false, capability }`; the API answers `PREMIUM_REQUIRED` with that
  capability, and the web opens the matching upgrade prompt. A new `PremiumCapabilitySchema` value needs a
  matching trigger in the web app.
- `MAX_CARDS_HARD_LIMIT` is a technical ceiling for every plan, not a plan feature.
- The checks are applied to published gifts only. A draft may use everything; `proFeaturesOf` then tells
  which paid features (`ProFeatureSchema`: `EXTRA_CARDS`, `VOICE_NOTE`, `TRIVIA`, `PREMIUM_REVEAL`) its
  content uses, measured against `PLAN_CAPABILITIES.FREE`. Publishing a FREE gift that uses any answers
  `PREMIUM_REQUIRED` with capability `PRO_FEATURES` and the list in `details.proFeatures`.
- The plan of a gift is derived with `planOf` from `isPremium`. There is no plan column.

## Slug rules

`SlugSchema`: length between `SLUG_MIN_LENGTH` and `SLUG_MAX_LENGTH`, lowercase letters, digits and single
hyphens, no hyphen at either end. `CustomSlugSchema` additionally requires a name followed by an ending
(`splitSlug`: the last hyphen-separated part, at least `SLUG_SUFFIX_MIN_LENGTH` letters or digits) and
refuses a name in `RESERVED_SLUGS` (route names and words that must not become links). `joinSlug` builds
a link from a name and an ending and shortens the name to fit. Generated links use an ending of
`GENERATED_SLUG_SUFFIX_LENGTH`; `SLUG_SUFFIX_LENGTH` is only the random ending proposed for a custom link.
`randomSlugSuffix(length)` draws without bias and uses Web Crypto, which
exists in Node and in browsers; the package declares it locally because it loads no platform types.

## Lifecycle periods

`packages/shared-types/src/lifecycle.ts` holds `DRAFT_TTL_DAYS`, `FREE_GIFT_TTL_YEARS`,
`EDIT_GRACE_HOURS`, `ANNIVERSARY_YEARS` and the date helpers `draftExpiry`, `freeGiftExpiry`,
`editableUntil`, `addYears`. The API computes with them and the web shows them; never repeat a period in
code or in a message.
`slugify` turns free text into slug form and may return a string
too short to be valid (even empty): validate its result.

## Text and media fields

In `packages/shared-types/src/gifts.ts`, the local helper `text(max)` trims, limits length and rejects the
NUL character (PostgreSQL cannot store it). Use it for every new free-text field. Media fields use the
local `mediaUrl` helper; the API further restricts them to files of the same gift (see
`.claude/skills/backend/references/gifts.md`).

## Who consumes it

- `apps/api`: controllers (`ZodPipe`), services, mappers, tests (responses are parsed with the schemas).
- `apps/web`: the API client and the editor. Code on the recipient path must use `import type` only, so
  Zod is not shipped to it. A breaking contract change breaks the web build: fix both in the same change.
- Card payloads are stored as JSON in `gift_cards.payload` and re-parsed with `CardSchema` on every read
  (`toCards` in `apps/api/src/modules/gifts/gift.mapper.ts`). Tightening a payload schema can make
  existing rows fail to load: add defaults or migrate the data.

## Decisions

- 2026-11-24: see the decisions in `.claude/skills/backend/references/gifts.md`; the periods and the link ending
  length they name are the constants listed here.

## Change checklist

- Schema and inferred type in the right file under `packages/shared-types/src/`; new file exported from
  `packages/shared-types/src/index.ts`; relative imports end in `.js`.
- Rebuild: `pnpm --filter @remember-me/shared-types build`.
- New error code: `ErrorCodeSchema`, `STATUS_BY_CODE`, the table above, and the web's error handling.
- New plan capability or changed limit: `PLAN_CAPABILITIES` (and `PlanCapabilitiesSchema`), a `check*`
  helper if it gates an action, `packages/shared-types/src/plans.test.ts`, the API test of the module that
  enforces it, and `docs/spec.md` if the plan table changes.
- New enum value that is also a Prisma enum (`CardType`, `RevealTemplate`, `GiftStatus`, `MediaKind`):
  `apps/api/prisma/schema.prisma` plus a migration (`.claude/skills/backend/references/database.md`).
- Update the file table here and `.claude/skills/backend/references/endpoints.md` if a request or
  response changed.
