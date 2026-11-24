# Local

Read this to run the project, the smoke test or the browser tests on a development machine.

## Run

1. `pnpm install` (pnpm through corepack; Node 24).
2. Copy `apps/api/.env.example` and `apps/web/.env.example` to `.env` next to them. A person does
   this; an agent never opens the real files.
3. `docker compose up -d postgres storage`, then `pnpm --filter api migrate:deploy`.
4. `pnpm dev`. Web on port 3000, API on port 4000.

Payments need Stripe test settings in the API `.env` and a webhook forwarder. The Stripe CLI
requires the events to be named:
`stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to localhost:4000/payments/webhook`.

## Checks

| Command             | Needs                                                  | Notes                                                                                  |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm format:check` | —                                                      | `pnpm format` fixes it                                                                 |
| `pnpm check:docs`   | —                                                      | Every path named in a skill must exist (`scripts/check-docs.mjs`)                      |
| `pnpm lint`         | —                                                      |                                                                                        |
| `pnpm typecheck`    | —                                                      |                                                                                        |
| `pnpm build`        | `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL` in the shell | Fails collecting `/for/[slug]` without them                                            |
| `pnpm test`         | Docker running                                         | API tests start PostgreSQL, Redis and S3Mock containers                                |
| `pnpm test:e2e`     | Docker running, a previous `pnpm build`                | `scripts/e2e.sh` runs Playwright inside its official image against the compose network |

## Whole stack from the images

`docker compose --profile app up --build` builds the three images and starts everything;
`bash scripts/smoke.sh` then creates, publishes, opens and deletes a gift through HTTP. Local
storage is S3Mock: files disappear when its container is recreated.

## Gotchas

- Stop dev servers by process id (`ss -ltnp` shows who holds 3000/4000). `pkill -f` on a pattern
  can kill the shell that runs it.
- The local database keeps data between runs; e2e and manual tests share it.
- Playwright cannot run on the host without system libraries; always go through `scripts/e2e.sh`.

## Change checklist

- A new required tool, port or step: update this file and the "Run locally" part of `README.md`.
- A new check: `.claude/skills/ops/references/pipeline.md` and the CI workflow.
