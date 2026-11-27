# HTTP endpoints

Read this before adding, changing or removing an endpoint. The table lists every endpoint that exists.

## Conventions

- No global prefix: paths are exactly as listed.
- Auth kinds: **none**; **edit token** (header named by `EDIT_TOKEN_HEADER`, checked in
  `GiftsService.authorize`); **gift grant** (`Authorization: Bearer <grant>`, `GiftGrantGuard`); **Stripe
  signature** (`stripe-signature` header over the raw body).
- Every non-2xx body is `ApiError` (`code`, `message`, optional `details`).
- Success status is the Nest default (201 for `POST`, 200 otherwise) unless noted.
- All endpoints can answer 429 `RATE_LIMITED` except health and the webhook.
- Contract names are exports of `@remember-me/shared-types`.

## gifts: `apps/api/src/modules/gifts/gifts.controller.ts`

Every edit-token route answers 404 `NOT_FOUND` for an unknown gift (checked before the token), 401
`UNAUTHORIZED` for a missing or wrong token, 400 `VALIDATION_ERROR` for a malformed UUID or body. All
return `GiftEditorView` unless noted.

| Method and path                       | Auth       | Request                        | Notable errors                                                                                                                                                                                 |
| ------------------------------------- | ---------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /gifts`                         | none       | `CreateGiftRequestSchema`      | Own throttler `gift-creation`. Returns `CreateGiftResponse` (the only time the edit token is sent)                                                                                             |
| `GET /gifts/check-slug`               | none       | query `slug` (string, max 200) | Always 200 with `SlugAvailability`; reasons `INVALID`, `RESERVED`, `TAKEN`; `suggestions` holds free alternatives when taken 429 `RATE_LIMITED` after `SLUG_CHECK_LIMIT` checks in ten minutes |
| `GET /gifts/:giftId`                  | edit token | —                              | —                                                                                                                                                                                              |
| `PATCH /gifts/:giftId`                | edit token | `UpdateGiftRequestSchema`      | 423 `GIFT_LOCKED`; 402 `PREMIUM_REQUIRED` (`REVEAL_TEMPLATE`, published gifts only); 400 foreign media URL; 422 `GIFT_INCOMPLETE` clearing the headline                                        |
| `DELETE /gifts/:giftId`               | edit token | —                              | 204, no body. Deletes the gift and its files for good, also when locked. Fails (gift kept) if a `gift.deleted` subscriber fails                                                                |
| `POST /gifts/:giftId/publish`         | edit token | —                              | 200. 422 `GIFT_INCOMPLETE` with `details.missing`; 402 `PREMIUM_REQUIRED` (`PRO_FEATURES`, with `details.proFeatures`) for a free gift using paid features                                     |
| `PUT /gifts/:giftId/slug`             | edit token | `ChangeSlugRequestSchema`      | 402 `PREMIUM_REQUIRED` (`CUSTOM_SLUG`) unless a paid link is pending; 409 `SLUG_TAKEN`; 400 for a link without a valid ending                                                                  |
| `POST /gifts/:giftId/cards`           | edit token | `CardInputSchema`              | 423 `GIFT_LOCKED`; 402 `PREMIUM_REQUIRED` (`CARD_TYPE`, `MAX_CARDS`, published gifts only); 409 `CONFLICT` at `MAX_CARDS_HARD_LIMIT`; 400 foreign media                                        |
| `PUT /gifts/:giftId/cards/order`      | edit token | `ReorderCardsRequestSchema`    | 423 `GIFT_LOCKED`; 400 unless the list holds every card of the gift exactly once                                                                                                               |
| `PATCH /gifts/:giftId/cards/:cardId`  | edit token | `CardInputSchema`              | 423 `GIFT_LOCKED`; 404 unknown card; 400 if the card type changes; 400 foreign media                                                                                                           |
| `DELETE /gifts/:giftId/cards/:cardId` | edit token | —                              | 423 `GIFT_LOCKED`; 404 unknown card; 422 `GIFT_INCOMPLETE` removing the last card of a published gift                                                                                          |

`GIFT_LOCKED` details follow `GiftLockedDetailsSchema`: `scope` is `RECIPIENT_NAME` (a published gift
changing that name) or `GIFT` (the correction window is over and the request holds no editing session).

Every editor endpoint also reads `x-edit-session` (`EDIT_SESSION_HEADER`): the grant of the last
`GiftEditorView`. It is optional and only matters after the correction window, where it lets an editor
that was opened in time go on saving (`.claude/skills/backend/references/gifts.md`, "Locking after
delivery").

## public gifts: `apps/api/src/modules/gifts/public-gifts.controller.ts`

| Method and path           | Auth | Response     | Notable errors                                                                                                                                                                                               |
| ------------------------- | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /public/gifts/:slug` | none | `PublicGift` | 404 for an unknown slug, a draft and an expired gift. Aliases also match 429 `RATE_LIMITED` (details `retryAfterSeconds`) for every lookup of a client that got `LINK_LOOKUP_MISS_LIMIT` 404s in ten minutes |

## media: `apps/api/src/modules/media/media.controller.ts`

Multipart, one file in field `file`. Both return `MediaUploadResponse`.

| Method and path      | Auth       | Size limit                   | Notable errors                                                                                                                              |
| -------------------- | ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /media/images` | gift grant | `MEDIA_LIMITS.imageMaxBytes` | 400 no file; 413 `PAYLOAD_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA`; 409 `CONFLICT` at the storage ceiling                                        |
| `POST /media/audio`  | gift grant | `MEDIA_LIMITS.audioMaxBytes` | Same, plus 402 `PREMIUM_REQUIRED` (`AUDIO_UPLOAD`) for a published gift whose plan has no `AUDIO_NOTE` card type; a draft may always upload |

## qr: `apps/api/src/modules/qr/qr.controller.ts`

| Method and path | Auth       | Request                                          | Response                                          | Notable errors                                                                                         |
| --------------- | ---------- | ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /qr`       | gift grant | query `format` (`QrFormatSchema`, default `png`) | File download, `Cache-Control: private, no-store` | 409 `CONFLICT` if the grant says unpublished; 402 `PREMIUM_REQUIRED` (`QR_FORMAT`); 400 unknown format |

## payments: `apps/api/src/modules/payments/payments.controller.ts`

| Method and path                   | Auth             | Request                        | Response                  | Notable errors                                                                                           |
| --------------------------------- | ---------------- | ------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /payments/prices`            | none             | —                              | `PricesResponse`          | 500 if Stripe cannot be read                                                                             |
| `POST /payments/checkout-session` | gift grant       | `CheckoutSessionRequestSchema` | `CheckoutSessionResponse` | 401 grant of another gift; 409 `CONFLICT` already premium or paid; 400 redirect URL outside `WEB_ORIGIN` |
| `POST /payments/confirm`          | gift grant       | —                              | `PaymentConfirmation`     | 200. Never errors on "not paid": answers `PENDING` or `NONE`                                             |
| `POST /payments/webhook`          | Stripe signature | raw Stripe event               | `{ received: true }`      | 200. 401 bad signature; 400 no body; 500 when handling fails (Stripe retries). Skips both throttlers     |

## health: `apps/api/src/health/health.controller.ts`

| Method and path | Auth | Response         | Notes                                                                     |
| --------------- | ---- | ---------------- | ------------------------------------------------------------------------- |
| `GET /health`   | none | `HealthResponse` | 200 with `database: up`, 503 with `database: down`. Skips both throttlers |

## Recipe: add or change an endpoint

1. Contract first: add or change the request and response schemas in `packages/shared-types/src/` and
   export them (see `.claude/skills/backend/references/contracts.md`). Rebuild the package.
2. Controller: one method, no logic. Validate with `new ZodPipe(Schema)` on `@Body` or `@Query`; ids with
   `ParseUUIDPipe`. Model: `apps/api/src/modules/gifts/gifts.controller.ts`.
3. Auth: an editor endpoint of `gifts` takes the edit token and calls `authorize` first. An endpoint of
   any other module that acts on a gift uses `@UseGuards(GiftGrantGuard)` and `@Grant()`; if the body also
   names a gift, compare it with `grant.giftId` (see `PaymentsService.createCheckoutSession`).
4. Service: fail with `AppError(code, message, details)`. A new code needs the steps in the contracts
   reference. Plan checks use the `check*` helpers and `PREMIUM_REQUIRED` with `{ capability }`.
5. A write that depends on a previous read of the gift runs in a transaction under `GiftsService.lock`.
6. Set `@HttpCode` when the default status is wrong (see `publish`, `confirm`, `remove`).
7. Test through HTTP (see `.claude/skills/backend/references/testing.md`): success, each auth failure,
   each listed error.

## Decisions

- 2026-11-24: the availability check is `GET /gifts/check-slug` (it replaced `GET /gifts/slug-availability`).
- 2026-11-24: deletion stays `DELETE /gifts/:giftId` with the edit token in the header; no endpoint takes the
  token in its path.

## Change checklist

- Controller and service of the module; contract in `packages/shared-types/src/`.
- Test in the module's file under `apps/api/test/`. An editor endpoint of `gifts` must also be added to the
  "rejects a missing or wrong token on every editor endpoint" test in `apps/api/test/gifts.test.ts`, and a
  helper method to `editor` in `apps/api/test/helpers.ts`.
- The table in this file (path, auth, contracts, errors).
- The web client that calls it lives in `apps/web`; changing or removing an endpoint breaks it.
- Domain rules changed: the module's reference (`gifts.md`, `media-qr.md` or `payments.md` in
  `.claude/skills/backend/references/`).
