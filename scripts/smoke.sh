#!/usr/bin/env bash
# Smoke test of a running stack (for example `docker compose --profile app up`): health, then one
# real flow through the API and the server-rendered gift page.
#   scripts/smoke.sh [api-url] [web-url]
set -euo pipefail
API="${1:-http://localhost:4000}"
WEB="${2:-http://localhost:3000}"
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)$1))"; }

echo "health: $(curl -fsS "$API/health")"
created=$(curl -fsS -X POST "$API/gifts" -H 'Content-Type: application/json' -d '{"locale":"en"}')
id=$(echo "$created" | json '.gift.id')
token=$(echo "$created" | json '.editToken')
call() { curl -fsS -X "$1" "$API/gifts/$id$2" -H "x-edit-token: $token" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

call POST /cards '{"type":"PHOTO_TEXT","payload":{"text":"Smoke test card"}}' >/dev/null
call PATCH '' '{"recipientName":"Smoke","reveal":{"headline":"It works"}}' >/dev/null
url=$(call POST /publish | json '.publicUrl')
slug="${url##*/}"
echo "published: $url"

page=$(curl -fsS "$WEB/$slug")
echo "$page" | grep -q 'For Smoke' || { echo "FAIL: gift page does not show the recipient"; exit 1; }
echo "gift page: rendered on the server with the gift"

status=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/gifts/$id" -H "x-edit-token: $token")
[ "$status" = 204 ] || { echo "FAIL: cleanup returned $status"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB/$slug")" = 404 ] || { echo "FAIL: deleted gift still served"; exit 1; }
echo "cleanup: gift deleted, page answers 404"
echo "OK"
