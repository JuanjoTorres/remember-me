# Configuration and environment variables

Read this before adding, changing or removing an environment variable of the API.

## How it works

- `apps/api/src/config/env.ts` holds `EnvSchema` (Zod) and `loadEnv`. `loadEnv` throws `InvalidEnvError`
  listing every invalid variable by name. The app does not boot with an invalid environment.
- `apps/api/src/config/config.module.ts` provides the result once, globally, under the `ENV` symbol.
  Application code injects it (`@Inject(ENV) env: Env`) and never reads `process.env`.
- `apps/api/src/main.ts` loads a local env file next to the app outside production, if one exists. Real
  env files are git-ignored. Never open or print one; the documented shape is `apps/api/.env.example`.
- Tests: `apps/api/src/config/env.test.ts` covers the schema.

## Variables

"Required" means no default: the app refuses to start without it.

| Variable                       | Required                   | Default       | What it does                                                                                               |
| ------------------------------ | -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                     | no                         | `development` | One of `development`, `test`, `staging`, `production`. Drives the restrictions below                       |
| `PORT`                         | no                         | `4000`        | Listen port                                                                                                |
| `DATABASE_URL`                 | yes                        | —             | PostgreSQL URL (`postgres` or `postgresql` scheme)                                                         |
| `WEB_ORIGIN`                   | yes                        | —             | Public origin of the web app: CORS, checkout redirect check, QR and public URLs. Trailing slashes removed  |
| `GRANT_SIGNING_SECRET`         | yes                        | —             | Signs gift grants. At least 32 characters                                                                  |
| `MEDIA_PUBLIC_URL`             | yes                        | —             | Public base URL of uploaded media; also the prefix accepted in card media URLs. Trailing slashes removed   |
| `S3_ENDPOINT`                  | yes                        | —             | S3-compatible endpoint (Cloudflare R2 in production, S3Mock locally)                                       |
| `S3_REGION`                    | no                         | `auto`        | Region passed to the S3 client                                                                             |
| `S3_BUCKET`                    | yes                        | —             | Bucket name                                                                                                |
| `S3_ACCESS_KEY_ID`             | yes                        | —             | Storage credential                                                                                         |
| `S3_SECRET_ACCESS_KEY`         | yes                        | —             | Storage credential                                                                                         |
| `S3_FORCE_PATH_STYLE`          | no                         | `true`        | The string `true` or `false`; parsed to a boolean                                                          |
| `STRIPE_SECRET_KEY`            | yes                        | —             | Secret or restricted key (`sk_` or `rk_`, test or live)                                                    |
| `STRIPE_WEBHOOK_SECRET`        | yes                        | —             | Webhook signing secret (`whsec_` prefix)                                                                   |
| `STRIPE_PRICE_ID_PREMIUM`      | yes                        | —             | Price of the full experience (`price_` prefix). The amount lives in Stripe                                 |
| `STRIPE_PRICE_ID_CUSTOM_SLUG`  | yes                        | —             | Price of the custom link order bump (`price_` prefix)                                                      |
| `STRIPE_API_BASE_URL`          | no                         | —             | Points the Stripe SDK at a local stand-in. Automated tests only                                            |
| `RATE_LIMIT_PER_MINUTE`        | no                         | `240`         | Requests per client IP per minute, all endpoints                                                           |
| `GIFT_CREATION_LIMIT_PER_HOUR` | no                         | `30`          | Gifts one client IP may start per hour                                                                     |
| `LINK_LOOKUP_MISS_LIMIT`       | no                         | `30`          | Links leading to no gift that one client IP may open in ten minutes before all its lookups are refused     |
| `TRUST_PROXY_HOPS`             | no                         | `0`           | Number of reverse proxies in front of the API                                                              |
| `EVENT_BUS_DRIVER`             | no                         | `memory`      | `memory` or `redis`                                                                                        |
| `REDIS_URL`                    | only with the redis driver | —             | `redis` or `rediss` URL                                                                                    |
| `SCHEDULED_JOBS`               | no                         | `on`          | `on` or `off`: whether this instance runs the daily jobs. The integration tests set `off`                  |
| `MAIL_DRIVER`                  | no                         | `log`         | `log` sends nothing; `resend` sends through Resend. Nothing sends email while the anniversary email is off |
| `RESEND_API_KEY`               | only with `resend`         | —             | Resend API key (`re_` prefix). An empty string counts as not set                                           |
| `MAIL_FROM`                    | only with `resend`         | —             | Sender of every email, on a domain verified in Resend. An empty string counts as not set                   |

## Environment restrictions (`superRefine` in `EnvSchema`)

- Staging and production: `GRANT_SIGNING_SECRET` must not contain the example value ("change-me").
- Production: `STRIPE_SECRET_KEY` must be a live key. Staging accepts test keys.
- Staging and production: `STRIPE_API_BASE_URL` must not be set.
- Any environment: `EVENT_BUS_DRIVER=redis` requires `REDIS_URL`.
- Any environment: `MAIL_DRIVER=resend` requires `RESEND_API_KEY` and `MAIL_FROM`.

## Rules for a new variable

- Validate as strictly as the value allows (URL with protocol, prefix, integer range). Coerce numbers with
  `z.coerce`. Normalise in the schema (see the trailing-slash transforms), not at the point of use.
- Give a default only when a safe one exists for every environment. Secrets never get a default.
- If a wrong value would be dangerous only in deployed environments, add a rule to `superRefine`.
- A `NEXT_PUBLIC_` or web variable does not belong here: the web app has its own
  `apps/web/src/config/env.ts`.
- Never hard-code a fallback at the point of use, and never log a secret.

## Decisions

None recorded yet.

## Change checklist

Files to touch when adding, renaming or removing a variable:

1. `apps/api/src/config/env.ts`: the schema entry with a doc comment, and any `superRefine` rule.
2. `apps/api/src/config/env.test.ts`: the `valid` base object if the variable is required, plus a test for
   each rule.
3. `apps/api/.env.example`: the variable with a comment (commented out if optional).
4. `apps/api/test/setup.ts`: a value for the integration tests if required.
5. `compose.yaml`: the `api` service (local stack). If it is a secret the user supplies, also the root
   `.env.example`.
6. `deploy/compose.prod.yaml`: the `api` service, and `deploy/.env.example` if the host must supply it.
7. `apps/web/playwright.config.ts`: the env of the API process started for browser tests, if required.
8. `docs/deploy.md` if the operator has to do something.
9. This file: the table and, if any, the restrictions.

Removing or renaming: search the whole repository for the name; the files above all hold copies.
