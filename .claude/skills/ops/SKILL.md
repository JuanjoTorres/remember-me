---
name: ops
description: Load before changing anything about how kardoo.me is built, shipped or run - Dockerfiles, compose files, the Caddy config, GitHub workflows, scripts/, the deploy guide - and before operating a server (deploy, logs, backup, restore, new environment).
---

# Ops

How the project is built, deployed and operated. `CLAUDE.md` wins over anything here.

## Rules

- Secrets live only in the `.env` file on each host and in GitHub environment secrets. Never read,
  print, copy or commit a real `.env`, a key or a certificate. The repo holds `.env.example` files.
- Nothing is pushed to `main` directly. A merged pull request deploys to staging; a version tag
  (`v1.2.3`) on a commit that staging already ran deploys to production.
- Staging and production share nothing: host folder, database, bucket, domains, Stripe webhook and
  keys are separate. Staging uses Stripe test mode and `NODE_ENV=staging`.
- The API is only reachable through Caddy. Do not publish the ports of `api`, `web` or `postgres`.
- A value that reaches a shell on the server from a workflow is validated in the workflow first
  (see the tag checks in `.github/workflows/deploy.yml`).
- Changing a server by hand (cron, firewall, packages, files outside the compose folder) is
  recorded in `references/environments.md` the same day, or it will be lost on the next rebuild.
- Destructive actions on a server (dropping a database, deleting a volume or a bucket, restoring a
  backup over live data) need the owner's explicit go-ahead each time.

## Where to look

| You are about to…                                                | Read                         |
| ---------------------------------------------------------------- | ---------------------------- |
| Know what exists in staging or production, or add an environment | `references/environments.md` |
| Change CI, the deploy workflow, image names or tags              | `references/pipeline.md`     |
| Change a Dockerfile, a compose file or the Caddy config          | `references/stack.md`        |
| Look at logs, restart, roll back, back up or restore             | `references/operations.md`   |
| Run the stack, the smoke test or the browser tests locally       | `references/local.md`        |

Open only the reference for the task. Environment variables of the apps themselves are documented
in `.claude/skills/backend/references/config-env.md` and
`.claude/skills/frontend/references/architecture.md`.

## Living documents

These files are part of the system. In the same change:

- A new or renamed workflow job, image, compose service, script, port, volume or deploy variable
  updates the matching reference and `docs/deploy.md` (the guide a person follows).
- When the owner says "this is how we do X", write it under a `Decisions` heading in the matching
  reference, with the date.
- If a reference and reality disagree, check reality (the file, the server, GitHub), fix the
  reference, and say so.

## Before finishing

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm check:docs`.
A change to a Dockerfile or compose file is also proven by building it:
`docker compose --profile app up --build` and `bash scripts/smoke.sh`. A workflow change cannot be
proven locally: say so, and watch its first run.
