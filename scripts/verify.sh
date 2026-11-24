#!/usr/bin/env bash
# The whole verification, as the reviewer runs it after every change: static checks, build, every
# unit and integration test several times over (a test that passes only sometimes is a failure),
# and the browser flows. Needs Docker. Run with `pnpm verify`.
#   VERIFY_TEST_RUNS=5 pnpm verify   # repeat the test suites more often (default 3)
set -euo pipefail
cd "$(dirname "$0")/.."

# Fixed on purpose, whatever the shell has exported: the web bundle embeds the API address, and the
# browser flows start the API on this one.
export NEXT_PUBLIC_API_URL=http://localhost:4000
export INTERNAL_API_URL=http://localhost:4000
runs="${VERIFY_TEST_RUNS:-3}"
if ! [[ "$runs" =~ ^[1-9][0-9]*$ ]]; then
  echo "VERIFY_TEST_RUNS must be a whole number, 1 or more (got '$runs')" >&2
  exit 2
fi

step() { printf '\n== %s ==\n' "$1"; }

# The tests and the browser flows need Docker: fail now, not after ten minutes of other checks.
docker info >/dev/null 2>&1 || { echo 'Docker is not running' >&2; exit 2; }

step 'format';     pnpm format:check
step 'docs';       pnpm check:docs
# --force everywhere: without it Turborepo replays a cached result and nothing actually runs.
step 'lint';       pnpm lint --force
step 'typecheck';  pnpm typecheck --force
step 'build';      pnpm build --force
for run in $(seq 1 "$runs"); do
  step "tests, run $run of $runs"
  pnpm test --force
done
step 'browser flows'; pnpm test:e2e

printf '\nverify: all checks passed, tests %s times.\n' "$runs"
