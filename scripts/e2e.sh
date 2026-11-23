#!/usr/bin/env bash
# Runs the Playwright smoke tests inside the official Playwright image, so that no browser or system
# library has to be installed on the host. Requires a previous `pnpm build`.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d --wait postgres storage
DATABASE_URL=postgresql://remember:remember@localhost:5432/remember_me pnpm --filter api migrate:deploy

docker run --rm \
  --network "$(basename "$PWD")_default" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e CI=1 \
  -e E2E_DATABASE_URL=postgresql://remember:remember@postgres:5432/remember_me \
  -e E2E_STORAGE_URL=http://storage:9090 \
  -v "$PWD:/repo" -w /repo/apps/web \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  npx playwright test "$@"
