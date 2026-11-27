# Deploying kardoo.me

Target: one VPS with Docker Compose. Caddy terminates TLS for two domains (web and API), PostgreSQL runs
on the host, media lives in Cloudflare R2. The images are independent, so `web` and `api` can later run as
separate pods without changes.

Staging has run this way since 2026-11-24 (`https://staging.kardoo.me`): the workflow, the server
steps, payments in Stripe test mode, uploads to R2 and the backup with a test restore have all been
exercised there. Production has not been created yet, so nothing here has been run with live
Stripe keys. What exists in each environment is recorded in
`.claude/skills/ops/references/environments.md`.

## One-time setup

1. **DNS:** point the web domain and the API domain at the VPS (staging: `staging.kardoo.me` and
   `api.staging.kardoo.me`). The zone is on Cloudflare; keep these records in "DNS only" mode, so
   that Caddy can obtain certificates and the API sees the visitor's address.
2. **Cloudflare R2:** create a bucket per environment, give it a public custom domain (this is
   `MEDIA_PUBLIC_URL`; it requires the DNS zone to be on Cloudflare), and create an API token with
   object read/write limited to that bucket. `S3_ENDPOINT` is the account endpoint without the
   bucket name.
3. **Stripe (test mode for staging, live mode for production):**
   - Create two products with one-time EUR prices: full experience and custom link.
   - Enable the payment methods you want in Settings → Payment methods: cards, Apple Pay, Google Pay.
     Bizum needs approval from Stripe first.
   - Add a webhook endpoint (scope "your account", payload style "snapshot")
     `https://<api-domain>/payments/webhook` for `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and
     `checkout.session.expired`; copy its signing secret.
   - Register the web domain for Apple Pay if Stripe asks for it.
4. **VPS:** open inbound TCP 22, 80 and 443 in the provider's firewall and nothing else. Install
   Docker, create a `deploy` user in the `docker` group that logs in with an SSH key made only for
   deployments, and turn password logins off. Create a folder owned by that user (staging uses
   `/opt/kardoo-staging`), copy `deploy/.env.example` there as `.env` (mode 600) and fill it in. `IMAGE_PREFIX` must be written in lowercase, whatever the casing of the
   GitHub owner or repository. The images are public while the
   repository is; if it becomes private, log the host in to GHCR with a token that can read packages.
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

`backup.sh` is copied to the VPS on each deploy. Schedule it in the crontab of the deploy user:

```
15 3 * * * cd /opt/kardoo-staging && bash backup.sh >> backup.log 2>&1
```

It keeps 14 days of dumps by default, in `backups/` inside the host folder. Staging has this
schedule. Copy the dumps off the host: that is not set up yet. Media is in R2 and is not included.
How to check a dump by restoring it into a scratch database is in
`.claude/skills/ops/references/operations.md`.

## Operations

- **Refunds due:** a payment that could not be delivered (paid twice, gift deleted before paying) sets
  `payment_orders.status = 'REFUND_DUE'` and logs `REFUND DUE`. Refund it from the Stripe Dashboard.
- **Expired gifts:** every night (03:15 UTC) the API deletes drafts older than 7 days and free gifts
  published more than three months ago, with their files in R2. Paid gifts are never deleted. Look for
  `GiftLifecycle` in the API logs.
- **Anniversary email:** switched off for now (technical debt). The API schedules no email job, so
  `MAIL_DRIVER` stays `log` and no mail provider has to be set up.
- **Guessing links:** a client that opens 30 links leading to no gift within ten minutes is refused every
  gift for the rest of those ten minutes (`LINK_LOOKUP_MISS_LIMIT`, per client IP, in memory per API
  instance). Many people
  behind one shared address count as one client.
- **Rate limits:** `RATE_LIMIT_PER_MINUTE`, `GIFT_CREATION_LIMIT_PER_HOUR` (per client IP). Counters are in
  memory, per API instance.
- **Several API instances:** set `EVENT_BUS_DRIVER=redis` and `REDIS_URL` so that events reach every
  instance, and move the rate limit counters to a shared store first.
