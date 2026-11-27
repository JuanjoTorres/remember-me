# Talking to the API

Read this before calling an endpoint from the web, handling an API error, or adding an environment variable.

## Environment (`apps/web/src/config/env.ts`)

| Variable              | Used by          | Notes                                                                                         |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | The browser      | Inlined at build time, so it is referenced literally in `clientEnv`. Needed for `pnpm build`. |
| `INTERNAL_API_URL`    | Server rendering | Pod-to-pod address. Read at runtime through `getServerEnv()`.                                 |
| `NODE_ENV`            | Server           | `development`, `test` or `production`.                                                        |

- Both URLs must be `http` or `https`; a trailing slash is stripped.
- `clientEnv` is parsed when the module is imported, so an invalid value fails the build and the server
  start. `getServerEnv()` throws if called in the browser and is called at boot from
  `apps/web/src/instrumentation.ts`.
- `apiBaseUrl()` returns the internal URL on the server and the public one in the browser. Nothing else in
  the app reads `process.env`.
- Tested by `apps/web/src/config/env.test.ts`.

Add a variable: the Zod schema in `apps/web/src/config/env.ts` (a `NEXT_PUBLIC_` one also needs a literal
`process.env.X` in `clientEnv`), `apps/web/.env.example`, the `env` block of `apps/web/vitest.config.ts`,
`apps/web/Dockerfile` (build argument for a public one), `apps/web/playwright.config.ts` if the server needs
it in e2e, and the compose file (see the `ops` skill).

## The shared client (`apps/web/src/features/shared/api/client.ts`)

- `apiJson<T>(path, request)`: sends and parses JSON; a 204 resolves to `undefined`.
- `apiBlob(path, request)`: same, returns a `Blob` (QR codes).
- `ApiRequest`: `method`, `body` (JSON value or `FormData`), `editToken`, `editSession`, `grant`, `signal`, `cache`.
- The base URL is `apiBaseUrl()`. `cache` defaults to `no-store`.
- Responses are not validated at runtime; the generic type is trusted. Types come from
  `@remember-me/shared-types`.

Headers it sets:

| Header                  | When                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| `x-edit-token`          | `editToken` given: the gift's secret, for the `gifts` editor endpoints         |
| `x-edit-session`        | `editSession` given: the grant of the gift's last answer (`giftApi` sends it)  |
| `Authorization: Bearer` | `grant` given: the short-lived gift grant, for media, QR and payment endpoints |
| `Content-Type` JSON     | A body that is not `FormData` (the browser sets the multipart boundary itself) |

The grant is part of `GiftEditorView` (`grant`, `grantExpiresAt`). Always pass it through `withGrant`, which
refreshes it once on `UNAUTHORIZED` (`apps/web/src/features/gift-creator/useGiftEditor.ts`).

## Errors

- Any non-2xx answer throws `ApiClientError` with `status`, `code` (`ErrorCode` from
  `packages/shared-types/src/errors.ts`), `message` and `details`. A body that cannot be parsed gives code
  `INTERNAL`.
- A network failure throws `ApiClientError` with status 0 and code `INTERNAL`. An abort is rethrown as the
  original `AbortError`.
- `isApiError(error, code?)` is the only way components test errors. Never match on `message`.

Codes the UI reacts to today:

| Code                | Where                                                           | Reaction                                          |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `PREMIUM_REQUIRED`  | `useGiftEditor`, `useUpload` in `MediaInputs.tsx`, `SharePanel` | Opens the upgrade sheet with the matching reason  |
| `GIFT_LOCKED`       | `useGiftEditor`                                                 | Message in the sticky bar; the gift is reloaded   |
| `UNAUTHORIZED`      | `withGrant`; `GiftEditor` on load                               | Refresh the grant once; drop a refused link token |
| `NOT_FOUND`         | `GiftEditor` on load                                            | "No access" screen                                |
| `UNSUPPORTED_MEDIA` | `useUpload`                                                     | Message per media kind                            |
| `PAYLOAD_TOO_LARGE` | `useUpload`                                                     | "File too large" message                          |
| `CONFLICT`          | `PremiumUpgradeSheet`                                           | "Already premium" message                         |
| any API error       | `onChangeSlug` in `SuccessScreen`                               | The pending link field shows "taken"              |

Everything else falls into a generic message of the component that made the call.

## Calls per feature

`apps/web/src/features/gift-creator/api.ts`:

| Function                    | Endpoint                                  | Auth       |
| --------------------------- | ----------------------------------------- | ---------- |
| `createGift(locale)`        | `POST /gifts`                             | none       |
| `giftApi(...).get`          | `GET /gifts/:id`                          | edit token |
| `giftApi(...).update`       | `PATCH /gifts/:id`                        | edit token |
| `giftApi(...).remove`       | `DELETE /gifts/:id`                       | edit token |
| `giftApi(...).publish`      | `POST /gifts/:id/publish`                 | edit token |
| `giftApi(...).changeSlug`   | `PUT /gifts/:id/slug`                     | edit token |
| `giftApi(...).addCard`      | `POST /gifts/:id/cards`                   | edit token |
| `giftApi(...).updateCard`   | `PATCH /gifts/:id/cards/:cardId`          | edit token |
| `giftApi(...).removeCard`   | `DELETE /gifts/:id/cards/:cardId`         | edit token |
| `giftApi(...).reorderCards` | `PUT /gifts/:id/cards/order`              | edit token |
| `uploadMedia`               | `POST /media/images`, `POST /media/audio` | grant      |
| `downloadQr`                | `GET /qr` with a `format` query           | grant      |

Every `giftApi` call except `remove` answers with the full `GiftEditorView`. `createGift` answers with the
gift and the edit token, which is returned only that once.

`apps/web/src/features/checkout/api.ts`:

| Function                | Endpoint                          | Auth  |
| ----------------------- | --------------------------------- | ----- |
| `getPrices`             | `GET /payments/prices`            | none  |
| `createCheckoutSession` | `POST /payments/checkout-session` | grant |
| `confirmPayment`        | `POST /payments/confirm`          | grant |

`apps/web/src/features/gift-experience/get-public-gift.ts` (server only, plain `fetch`, not this client):
`GET /public/gifts/:slug` on `INTERNAL_API_URL`, forwarding the visitor's address as `X-Forwarded-For`.

`gift-reveal` and `shared` make no API calls.

## Which base URL is used where

All calls through the shared client today are made from client components, so they use
`NEXT_PUBLIC_API_URL`. The only server-side call is `getPublicGift`, on `INTERNAL_API_URL`.

## Add a call

1. Add or reuse the request and response types in `packages/shared-types/src` and rebuild that package.
2. Add a function to the feature's `api.ts`. Components do not call `apiJson` directly.
3. Editor mutations go through `editor.run`; grant-protected calls through `withGrant`.
4. Handle the error codes the endpoint can return with `isApiError`.

## Decisions

None recorded yet.

## Change checklist

- Code: the feature's `api.ts`; `apps/web/src/features/shared/api/client.ts` only for a new header or
  transport rule.
- Tests: component tests mock the feature's `api.ts` with `vi.mock`, so add the new function to the mocks
  that list functions by hand (`apps/web/src/features/gift-creator/components/GiftEditor.test.tsx`).
- References: the tables above; `.claude/skills/backend/references/endpoints.md` for the endpoint,
  `.claude/skills/backend/references/contracts.md` for the types and error codes.
- New env var: every file listed under "Add a variable".
