# Stack

Read this before changing a Dockerfile, a compose file or the Caddy configuration.

## Images

| Image     | Built from            | Target    | Runs                                       |
| --------- | --------------------- | --------- | ------------------------------------------ |
| `api`     | `apps/api/Dockerfile` | `runtime` | The NestJS API on port 4000                |
| `migrate` | `apps/api/Dockerfile` | `migrate` | Pending Prisma migrations, then exits      |
| `web`     | `apps/web/Dockerfile` | `runtime` | The Next.js standalone server on port 3000 |

The build context is the repository root (the workspace is needed). `.dockerignore` keeps
`node_modules`, build output and env files out of it. The web image takes the build argument
`NEXT_PUBLIC_API_URL`.

## Server stack (`deploy/compose.prod.yaml`)

| Service    | Notes                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `caddy`    | The only published ports (80, 443). Reads `deploy/Caddyfile`; certificates in a volume.                                                                                        |
| `postgres` | PostgreSQL 17, data in the `postgres-data` volume, not published.                                                                                                              |
| `migrate`  | Runs before `api` on every `up`; `api` waits for it to finish successfully.                                                                                                    |
| `api`      | Gets every setting from the host `.env` through the compose file. `TRUST_PROXY_HOPS: 1` because Caddy is the one proxy in front. `EVENT_BUS_DRIVER: memory` (single instance). |
| `web`      | Talks to the API inside the network (`INTERNAL_API_URL: http://api:4000`); waits for a healthy API.                                                                            |

`deploy/Caddyfile` has one site per domain (`WEB_DOMAIN`, `API_DOMAIN`) and caps request bodies on
the API site; the API enforces the real upload limits. `deploy/.env.example` lists every value the
host `.env` must define.

## Local stack (`compose.yaml`)

`postgres` and `storage` (S3Mock standing in for R2; not persistent) always; the `app` profile adds
`migrate`, `api` and `web` built from the Dockerfiles. Details in
`.claude/skills/ops/references/local.md`.

## Rules

- A setting the API needs in production is added in three places: the Zod schema of the app,
  `deploy/compose.prod.yaml` (passed to the container) and `deploy/.env.example`. `compose.yaml`
  gets a local value too.
- Database name, user and the local bucket are still called `remember_me` / `remember` /
  `remember-me`. Renaming them means migrating data on every host: do not do it in passing.
- Do not add a published port to `api`, `web` or `postgres` in the server stack.
- A second API instance needs `EVENT_BUS_DRIVER=redis`, a Redis service, and rate-limit counters
  moved to a shared store first (see `.claude/skills/backend/references/events.md`).

## Change checklist

- Build and run it: `docker compose --profile app up --build`, then `bash scripts/smoke.sh`.
- Update `docs/deploy.md` if a person setting up a host has to do something different.
- Update `.claude/skills/ops/references/pipeline.md` if images, targets or copied files change.
