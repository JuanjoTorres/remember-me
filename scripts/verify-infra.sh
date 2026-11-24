#!/usr/bin/env bash
# The extra verification for a change to a Dockerfile, .dockerignore, a compose file, the Caddy
# configuration or anything else that ends up in the images, which `pnpm verify` does not cover:
# checks the Caddy configuration, builds the three images, starts the whole stack from them and runs
# the smoke test against it. Run with `pnpm verify:infra`.
# Ports 3000 and 4000 must be free. The app containers are removed at the end; the local database
# and storage containers are left running.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s ==\n' "$1"; }
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    # Keep the evidence: once the containers are removed their logs are gone.
    printf '\n== failed: last log lines of the app containers ==\n'
    docker compose --profile app logs --tail 60 migrate api web 2>&1 || true
  fi
  docker compose --profile app rm --stop --force migrate api web >/dev/null 2>&1 || true
}
trap cleanup EXIT

step 'Caddy configuration'
# Syntax and directives only. Certificates and real routing are proven on a deployed host.
docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e WEB_DOMAIN=web.test -e API_DOMAIN=api.test \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile

step 'production compose file'
# Parsed with the example values; nothing is started from it. This catches broken YAML and image
# names, not a variable missing from the host's .env (compose only warns about those).
docker compose --env-file deploy/.env.example -f deploy/compose.prod.yaml config --quiet

step 'build images and start the stack'
docker compose --profile app up --build --detach --wait

step 'wait for the web'
# The web container has no healthcheck, so `--wait` returns as soon as its process starts.
for attempt in $(seq 1 60); do
  curl -fsS --max-time 5 -o /dev/null http://localhost:3000/ 2>/dev/null && break
  [ "$attempt" = 60 ] && { echo 'The web did not answer on port 3000 within 60 s' >&2; exit 1; }
  sleep 1
done

step 'smoke test'
bash scripts/smoke.sh

printf '\nverify:infra: images built, stack started, smoke test passed.\n'
