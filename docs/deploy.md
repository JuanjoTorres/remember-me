# Deploying remember.me

Target: one VPS with Docker Compose. Caddy terminates TLS for two domains (web and API), PostgreSQL runs
on the host, media lives in Cloudflare R2. The images are independent, so `web` and `api` can later run as
separate pods without changes.

This setup has not been run against a real host yet: the images, the compose file syntax and the local
stack are verified, the workflow and the VPS steps are not.

## One-time setup

1. **DNS:** point the web domain and the API domain at the VPS.
2. **Cloudflare R2:** create a bucket, give it a public custom domain (this is `MEDIA_PUBLIC_URL`), and
   create an API token with object read/write on that bucket.
3. **Stripe (live mode):**
   - Create two products with one-time EUR prices: full experience and custom link.
   - Enable the payment methods you want in Settings → Payment methods: cards, Apple Pay, Google Pay.
     Bizum needs approval from Stripe first.
   - Add a webhook endpoint `https://<api-domain>/payments/webhook` for `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and
     `checkout.session.expired`; copy its signing secret.
   - Register the web domain for Apple Pay if Stripe asks for it.
4. **VPS:** install Docker, create a folder (for example `/opt/remember-me`), copy `deploy/.env.example`
   there as `.env` and fill it in. `IMAGE_PREFIX` must be written in lowercase, whatever the casing of the
   GitHub owner or repository. Log in to GHCR if the images are private.
5. **GitHub repository**, Settings → Environments: create `staging` and `production`. In each one:
   - Variables: `NEXT_PUBLIC_API_URL` (`https://<api-domain>` of that environment) and `DEPLOY_PATH` (the
     folder on its host).
   - Secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <host>`).
   - For `production`, add yourself as a required reviewer, so that a release waits for your approval.
6. **Switch each environment on** when its host is ready, with a repository variable (Settings → Secrets
   and variables → Actions → Variables): `STAGING_DEPLOY_ENABLED=true`, `PRODUCTION_DEPLOY_ENABLED=true`.
   Until then the workflow runs and skips the deploy.

## Environments

|                                   | Staging                          | Production                          |
| --------------------------------- | -------------------------------- | ----------------------------------- |
| Deployed by                       | every push to `main`             | a version tag (`v1.2.3`)            |
| Image tag                         | `main-<commit>`                  | the version tag                     |
| `NODE_ENV` in the host `.env`     | `staging`                        | `production`                        |
| Stripe keys                       | test mode                        | live mode                           |
| Storage                           | its own R2 bucket                | its own R2 bucket                   |
| `IMAGE_PREFIX` in the host `.env` | `ghcr.io/<owner>/<repo>/staging` | `ghcr.io/<owner>/<repo>/production` |

Each environment has its own host folder, database, bucket, domains and Stripe webhook endpoint. Nothing
is shared, so staging can be reset freely. The web image is built per environment because the API address
is embedded in the browser bundle.

The API must only be reachable through Caddy. The web app passes each visitor's address to the API in
`X-Forwarded-For` so that rate limits apply per visitor; a client that could reach the API directly could
fake that header.

## Releasing

Merging a pull request into `main` deploys to staging. To release to production, tag the commit on `main`
that staging has been running with a version (`v0.1.0`) and push the tag. In both cases the `Deploy`
workflow builds multi-arch images, pushes them to GHCR, copies the compose file to the host and restarts
the stack.
Migrations run in the `migrate` container before the API starts.

After the first deploy, check `https://<api-domain>/health` and run
`scripts/smoke.sh https://<api-domain> https://<web-domain>`.

## Backups

`backup.sh` is copied to the VPS on each deploy. Schedule it with cron (`bash backup.sh`); it keeps 14 days of dumps by
default. Copy the dumps off the host. Media is in R2 and is not included.

## Operations

- **Refunds due:** a payment that could not be delivered (paid twice, gift deleted before paying) sets
  `payment_orders.status = 'REFUND_DUE'` and logs `REFUND DUE`. Refund it from the Stripe Dashboard.
- **Rate limits:** `RATE_LIMIT_PER_MINUTE`, `GIFT_CREATION_LIMIT_PER_HOUR` (per client IP). Counters are in
  memory, per API instance.
- **Several API instances:** set `EVENT_BUS_DRIVER=redis` and `REDIS_URL` so that events reach every
  instance, and move the rate limit counters to a shared store first.
