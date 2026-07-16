#!/usr/bin/env bash
# Backup diário do Postgres. Adicione ao cron do host:
#   0 3 * * * /opt/vyntrixsync/backend/scripts/backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/vyntrix}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/vyntrix_${TS}.sql.gz"

echo "==> Backup para $OUT"
docker compose -f /opt/vyntrixsync/backend/docker-compose.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-vyntrix}" -d "${POSTGRES_DB:-vyntrix}" \
  | gzip > "$OUT"

echo "==> Removendo backups > $KEEP_DAYS dias"
find "$BACKUP_DIR" -name "vyntrix_*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "OK"
