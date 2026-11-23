#!/usr/bin/env bash
# Dumps the production database to a compressed file and removes old dumps. Run on the host, from
# the folder that holds compose.prod.yaml, e.g. from cron:
#   15 3 * * * cd /opt/remember-me && ./backup.sh >> backup.log 2>&1
# Media lives in Cloudflare R2 and is not part of this backup.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"

mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/remember_me-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U remember -d remember_me --no-owner \
  | gzip > "$target.partial"
# Only a complete dump gets the final name.
mv "$target.partial" "$target"
find "$BACKUP_DIR" -name 'remember_me-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup written: $target ($(du -h "$target" | cut -f1))"
