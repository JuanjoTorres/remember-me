# Environments

Read this to know what exists outside the repository, or before creating a new environment.

## Overview

|                    | Staging                                    | Production                        |
| ------------------ | ------------------------------------------ | --------------------------------- |
| State              | Running since 2026-11-24                   | Not created yet                   |
| Deployed by        | Every push to `main`                       | A tag `v1.2.3`                    |
| Web                | `https://staging.kardoo.me`                | `https://kardoo.me`               |
| API                | `https://api.staging.kardoo.me`            | `https://api.kardoo.me`           |
| Media              | `https://media.staging.kardoo.me`          | to be decided                     |
| Host folder        | `/opt/kardoo-staging`                      | to be decided                     |
| `NODE_ENV` on host | `staging`                                  | `production`                      |
| Stripe             | Test mode (sandbox of the kardoo account)  | Live mode                         |
| Image path         | `ghcr.io/juanjotorres/remember-me/staging` | `…/production`                    |
| GitHub switch      | `STAGING_DEPLOY_ENABLED=true`              | `PRODUCTION_DEPLOY_ENABLED` unset |

## Staging, piece by piece

- **Server:** one Hetzner Cloud ARM instance (2 vCPU, 4 GB), Ubuntu 24.04, Docker from
  `get.docker.com`. Its address is the A record of `staging.kardoo.me`.
- **Access:** SSH keys only (`PasswordAuthentication no` in
  `/etc/ssh/sshd_config.d/00-no-passwords.conf`). User `deploy` (member of `docker`) owns
  `/opt/kardoo-staging` and is the user the workflow connects as, with a key made only for that.
  `root` is for the owner.
- **Firewall (Hetzner Cloud Firewall):** inbound TCP 22, 80, 443 and ICMP from anywhere. Nothing
  else. Port 22 cannot be limited by address because GitHub runners change address.
- **Host folder:** `.env` (mode 600, written by hand), `compose.prod.yaml`, `Caddyfile` and
  `backup.sh` (copied by every deploy), `backups/` and `backup.log` (written by cron).
- **Cron (user `deploy`):** `15 3 * * *` runs `backup.sh`. Times are UTC.
- **DNS:** the zone `kardoo.me` is on Cloudflare (registered at Namecheap, nameservers pointed to
  Cloudflare). `staging` and `api.staging` are A records in "DNS only" mode: Caddy obtains its own
  certificates and the API sees the visitor's address. `media.staging` is created by R2 and is
  proxied. The apex and `www` have no records until production exists.
- **Storage:** Cloudflare R2 bucket `kardoo-staging`, public through the custom domain
  `media.staging.kardoo.me`, written with an API token limited to that bucket.
- **Stripe:** webhook destination `https://api.staging.kardoo.me/payments/webhook`, snapshot
  payloads, the four `checkout.session.*` events listed in `docs/deploy.md`.
- **GitHub environment `staging`:** variables `NEXT_PUBLIC_API_URL`, `DEPLOY_PATH`; secrets
  `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`.

## Not done yet

- Production: nothing exists. If it shares the staging server, a full disk or a crash in one
  environment takes the other down; the owner has not decided.
- Putting Cloudflare's proxy in front of the web and API. It needs three coordinated changes:
  SSL mode "Full (strict)", `TRUST_PROXY_HOPS` raised by one in `deploy/compose.prod.yaml`, and the
  firewall limited to Cloudflare's addresses for 80 and 443.
- Copying backups off the host.
- Owner decisions: EU VAT on digital goods, legal notice on the privacy page, Bizum approval,
  trademark check for the name.

## Decisions

- 2026-11-23: the public brand is kardoo.me (remember.me belongs to someone else). The repository,
  the package scope `@remember-me/*`, the database name and the local bucket keep the first name.
- 2026-11-23: DNS on Cloudflare rather than at the registrar, because an R2 custom domain needs it.
- 2026-11-24: staging lives in subdomains (`staging`, `api.staging`, `media.staging`); the apex is
  reserved for production.

## Change checklist

- New environment: follow `docs/deploy.md` end to end, then fill in the column above.
- Any manual change on a server or in Cloudflare, Stripe or GitHub settings: update this file.
- A new deploy variable or secret: also `.claude/skills/ops/references/pipeline.md`,
  `docs/deploy.md` and `deploy/.env.example`.
