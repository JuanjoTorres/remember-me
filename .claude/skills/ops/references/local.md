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
| `pnpm check:docs`   | —                                                      | Every path named in a skill or agent definition must exist (`scripts/check-docs.mjs`)  |
| `pnpm lint`         | —                                                      |                                                                                        |
| `pnpm typecheck`    | —                                                      |                                                                                        |
| `pnpm build`        | `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL` in the shell | Fails collecting the gift pages without them                                           |
| `pnpm test`         | Docker running                                         | API tests start PostgreSQL, Redis and S3Mock containers                                |
| `pnpm test:e2e`     | Docker running, a previous `pnpm build`                | `scripts/e2e.sh` runs Playwright inside its official image against the compose network |

`pnpm verify` (`scripts/verify.sh`) runs all of the above in order, with Turborepo's cache
bypassed for lint, typecheck, build and tests, the test suites three times (`VERIFY_TEST_RUNS`,
at least 1) and then the browser flows. It fixes the API address to `http://localhost:4000`. It is what
the `reviewer` agent runs after every code change; a change made only of Markdown needs just
`pnpm format:check && pnpm check:docs`. Plain `pnpm test` replays a cached result when nothing
changed: use `pnpm test --force` to really run the tests again.

## Whole stack from the images

`pnpm verify:infra` (`scripts/verify-infra.sh`) does all of this in one go and removes the app
containers afterwards; it is what the reviewer runs for a Docker, compose or Caddy change. By hand:
`docker compose --profile app up --build` builds the three images and starts everything;
`bash scripts/smoke.sh` then creates, publishes, opens and deletes a gift through HTTP. Local
storage is S3Mock: files disappear when its container is recreated.

## Decisions

- 2026-11-24: the full review (a fresh `reviewer` agent, `pnpm verify`, and `pnpm verify:infra`
  when it applies) is mandatory for code changes only. A change made only of Markdown (`docs/**`,
  `README.md`, `CLAUDE.md`, `.claude/skills/**`, `.claude/agents/**`) needs
  `pnpm format:check && pnpm check:docs` and nothing else. Reviewing every documentation touch-up
  in full cost ten minutes a round, and one change went through five rounds. The rule itself is
  `CLAUDE.md` section 7.

## Gotchas

- Stop dev servers by process id (`ss -ltnp` shows who holds 3000/4000). `pkill -f` on a pattern
  can kill the shell that runs it.
- The local database keeps data between runs; e2e and manual tests share it.
- `compose.yaml` fixes the project name to `remember-me`, so every checkout, a git worktree
  included, uses the same containers, network and volume. `pnpm verify` and `pnpm verify:infra`
  run from a worktree reuse the database and storage that are already up instead of starting a
  second pair on the same ports.
- Playwright cannot run on the host without system libraries; always go through `scripts/e2e.sh`.

## Change checklist

- A new required tool, port or step: update this file and the "Run locally" part of `README.md`.
- A new check: `scripts/verify.sh`, the CI workflow and `.claude/skills/ops/references/pipeline.md`.
