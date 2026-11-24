# Pipeline

Read this before changing `.github/workflows/ci.yml` or `.github/workflows/deploy.yml`.

## CI (`.github/workflows/ci.yml`)

Runs on every pull request and on pushes to `main`. A newer run on the same ref cancels the older.

| Job      | Steps                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| `verify` | install (frozen lockfile), `format:check`, `check:docs`, `lint`, `typecheck`, `build`, `test` |
| `e2e`    | after `verify`: install, `build`, `test:e2e` (Playwright in Docker, see `scripts/e2e.sh`)     |

`verify` runs the tests one package at a time (`pnpm test --concurrency=1`): in parallel, the API
test containers starved the web component tests on the runner and time-sensitive tests failed at
random (seen on `main` on 2026-11-24).

Both jobs set `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` to `http://localhost:4000`: the web
build fails without them. API tests start their own containers through Testcontainers.

## Deploy (`.github/workflows/deploy.yml`)

Triggers: push to `main` (staging) and tags starting with `v` (production). One deploy at a time
per environment; a newer one waits.

| Job      | What it does                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`   | Picks the environment, the image tag (`main-<7 hex>` or the version tag) and the image path. Rejects tags that are not `v1.2.3`. Reads the repository variables that switch each environment on.              |
| `images` | Skipped unless the environment is switched on. Builds `api`, `migrate` and `web` for amd64 and arm64 and pushes them to GHCR as `<prefix>/<environment>/<name>:<tag>`.                                        |
| `deploy` | Over SSH: checks the tag again, copies `deploy/compose.prod.yaml`, `deploy/Caddyfile` and `scripts/backup.sh` to the host folder, rewrites `IMAGE_TAG` in the host `.env`, pulls, `up -d`, prunes old images. |

Things that are easy to break:

- The web image embeds `NEXT_PUBLIC_API_URL` at build time, so it is built per environment and the
  environment is part of the image name.
- The image path must be lowercase; `plan` lowercases the repository name.
- The tag is interpolated into a remote command. Both regular expressions that validate it must
  stay in step with the tag formats `plan` produces.
- The workflow has no manual trigger. To deploy the current `main` again, re-run its last Deploy
  run (`gh run rerun <id>`); repository variables are read again on a re-run.
- The GHCR packages were created by this workflow in a public repository and the host pulls them
  without logging in. If the repository becomes private, the host needs `docker login ghcr.io`
  with a token that can read packages.

## Settings the workflows read

| Kind                 | Name                                                                 | Where                |
| -------------------- | -------------------------------------------------------------------- | -------------------- |
| Repository variable  | `STAGING_DEPLOY_ENABLED`, `PRODUCTION_DEPLOY_ENABLED` (`true`)       | Actions → Variables  |
| Environment variable | `NEXT_PUBLIC_API_URL`, `DEPLOY_PATH`                                 | Environment settings |
| Environment secret   | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | Environment settings |

## Change checklist

- A new check: add it to `verify`, to the "Before finishing" line of every skill and to
  `README.md`.
- A new image or build argument: the `images` matrix, `deploy/compose.prod.yaml`, the matching
  Dockerfile, and `.claude/skills/ops/references/stack.md`.
- A new file the host needs: the `scp` line of the `deploy` job.
- A new variable or secret: the table above, `docs/deploy.md`,
  `.claude/skills/ops/references/environments.md`.
- A workflow change is only proven by its first run. Say that in the pull request and watch it.
