# Auth and security

Read this before changing edit tokens, gift grants, rate limits, CORS, security headers or proxy trust.

There are no user accounts. Access is by possession of a secret tied to one gift.

## The four kinds of access

| Kind             | Proves                                 | Checked by                                                                    |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| None             | Nothing                                | Rate limits only. Create gift, slug availability, prices, public gift, health |
| Edit token       | The caller created the gift            | `GiftsService.authorize`, inside the `gifts` module only                      |
| Gift grant       | The caller recently proved edit access | `GiftGrantGuard`, in `media`, `qr`, `payments`                                |
| Stripe signature | The request comes from Stripe          | `StripePaymentGateway.parseWebhook`                                           |

The public gift endpoint has no credential by design: the slug is the secret, and only published gifts
are served.

## Edit token

- Generated in `apps/api/src/modules/gifts/edit-token.ts` from random bytes, returned once by
  `POST /gifts`. Only its SHA-256 hash is stored; comparison is constant time.
- Sent in the header named by `EDIT_TOKEN_HEADER` (`packages/shared-types/src/gifts.ts`).
- Checked on every editor endpoint. An unknown gift answers `NOT_FOUND` before the token is looked at.
- No rotation, no recovery, no expiry. Never log it, never return it again, never put it in a grant.

## Gift grant

Implemented in `apps/api/src/shared/auth/gift-grant.service.ts`; guard and decorator in
`apps/api/src/shared/auth/gift-grant.guard.ts`; both provided globally by
`apps/api/src/shared/auth/auth.module.ts`.

- What it is: a signed snapshot of one gift, so that other modules do not have to call `gifts`. Format:
  base64url JSON body, a dot, an HMAC-SHA256 signature with `GRANT_SIGNING_SECRET`.
- Claims (`GrantClaimsSchema`): `giftId`, `slug`, `plan`, `published`, `exp`.
- Lifetime: `GRANT_TTL_SECONDS`. `verify` rejects a bad shape, a wrong signature (constant-time compare),
  claims that do not parse, and an expired grant, all as `UNAUTHORIZED`.
- Issued only by `gifts`: `GiftsService.view` puts a fresh one in every `GiftEditorView` (`grant`,
  `grantExpiresAt`). The web refreshes it by re-reading the gift with the edit token.
- Used with `@UseGuards(GiftGrantGuard)` and the `@Grant()` parameter decorator, which yields
  `GiftGrantClaims`. The guard reads `Authorization: Bearer <grant>`.
- A grant is a snapshot and can be stale until it expires: a `FREE` grant may outlive the payment, an
  unpublished one the publication, and a grant survives the deletion of its gift. A module must
  double-check on its own data whenever staleness would cost money or integrity (model:
  `PaymentsService.createCheckoutSession` checks its own orders under a lock).
- It is not revocable. Do not lengthen the lifetime to make something convenient.

## What each module may trust

- `gifts`: the edit token, and its own tables.
- `media`, `qr`, `payments`: the verified grant claims, and their own tables. Never a gift id, plan or
  slug taken from the body or query without comparing it to the grant.
- `payments`: for payment facts, only a signature-verified webhook or a session read back from Stripe.
  What was bought comes from the module's own order row.
- Media URLs in cards: only the prefix and extension rule of `MediaUrlPolicy`.

## Rate limits

Configured in `apps/api/src/app.module.ts` with `@nestjs/throttler`; `ThrottlerGuard` is global.

| Throttler       | Window     | Limit (env var)                | Applies to                            |
| --------------- | ---------- | ------------------------------ | ------------------------------------- |
| `default`       | one minute | `RATE_LIMIT_PER_MINUTE`        | Every route                           |
| `gift-creation` | one hour   | `GIFT_CREATION_LIMIT_PER_HOUR` | Only `POST /gifts` (`isGiftCreation`) |

- Per client IP. `isGiftCreation` tolerates a trailing slash and letter case, like the router, so the
  limit cannot be dodged by spelling the path differently.
- `GET /health` and `POST /payments/webhook` skip both (`@SkipThrottle` naming both throttlers). A new
  throttler must be added to those decorators too.
- A refused request is 429 with code `RATE_LIMITED`.
- Storage is in memory per instance.
- Separate from these: `PaymentsService.confirm` limits its own calls to Stripe
  (`.claude/skills/backend/references/payments.md`).

Besides the throttlers, `LinkGuessGuard` limits how many links one client may try (wrong links opened,
availability checks made): see "Guessing links" in `.claude/skills/backend/references/gifts.md`. It also
keys on the request IP, so it depends on the same proxy trust.

## Proxy trust

`configureApp` sets Express `trust proxy` to `TRUST_PROXY_HOPS`. It must equal the number of reverse
proxies in front of the API (the production compose file sets it for its one proxy), otherwise every
client shares the proxy's IP, or clients can spoof their IP through `X-Forwarded-For`.

## CORS and headers

In `apps/api/src/bootstrap.ts`:

- CORS allows exactly one origin, `WEB_ORIGIN` (normalised without trailing slash by the env schema).
- helmet with its defaults, except `Cross-Origin-Resource-Policy: cross-origin`, so the web origin can load
  the QR image.
- `GET /qr` answers `Cache-Control: private, no-store`.

## Other protections in place

- Redirect check: checkout `successUrl` and `cancelUrl` must have the origin `WEB_ORIGIN`.
- Uploads: size limits before buffering completes, content sniffing instead of trusting names or declared
  types, a pixel limit for images, metadata stripped, a per-gift asset ceiling.
- Errors: unexpected exceptions are logged server-side and answered with a generic message
  (`AppExceptionFilter`).
- Secrets: the env schema refuses the example signing secret in staging and production, requires a live
  Stripe key in production, and refuses the Stripe stand-in URL in deployed environments.
- Free text rejects the NUL character at the contract level.

## Decisions

None recorded yet.

## Change checklist

- New grant claim: `GrantClaimsSchema`, the `issue` call in `GiftsService.view`, the fixtures in
  `apps/api/src/shared/auth/gift-grant.service.test.ts`. Old grants without the claim fail verification
  until they expire; make the claim optional if that matters.
- New protected endpoint: guard plus a test for a missing, foreign and (where relevant) stale grant.
- Rate limit change: `apps/api/src/app.module.ts`, the env var
  (`.claude/skills/backend/references/config-env.md`), `apps/api/test/rate-limit.test.ts`.
- Header, CORS or proxy change: `apps/api/src/bootstrap.ts` and the "sends hardening headers" test.
- Update this file and `.claude/skills/backend/references/endpoints.md` (auth column).
