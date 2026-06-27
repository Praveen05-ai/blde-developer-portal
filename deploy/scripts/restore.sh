#!/bin/bash
# ==============================================================================
# BLDE EDC — CLINICAL TRIAL RECOVERY AND RESTORE ENGINE
# ==============================================================================
set -e

GREEN='\033[0;32m'
NC='\033[0m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}           BLDE(DU) Clinical Research Platform — Recovery Engine              ${NC}"
echo -e "${BLUE}==============================================================================${NC}"

# Find active deployment folder
ACTIVE_DIR=""
for dir in "../laptop" "../lab" "../university"; do
  if [ -f "$dir/docker-compose.yml" ] && docker compose -f "$dir/docker-compose.yml" ps --format json | grep -q "running"; then
    ACTIVE_DIR="$dir"
    break
  fi
done

if [ -z "$ACTIVE_DIR" ]; then
  echo -e "❌ Error: Could not locate active local database containers. Recovery aborted."
  exit 1
fi

cd "$(dirname "$0")"
BACKUP_DIR="../backups"

if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR")" ]; then
  echo -e "${RED}❌ Error: No backups found inside '$BACKUP_DIR'. Please copy backup files here first.${NC}"
  exit 1
fi

# List available backups
echo -e "\nAvailable Backup Packages:"
select file in "$BACKUP_DIR"/*.tar.gz; do
  if [ -n "$file" ]; then
    BACKUP_FILE="$file"
    break
  else
    echo -e "${RED}Invalid selection. Select a valid number.${NC}"
  fi
done

echo -e "\nRestoring Backup: ${BLUE}$BACKUP_FILE${NC}"
read -rp "WARNING: This will overwrite existing database records! Are you sure? [y/N]: " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
  echo -e "❌ Restore aborted."
  exit 0
fi

TEMP_DIR="/tmp/blde_restore_extract"
rm -rf "$TEMP_DIR" && mkdir -p "$TEMP_DIR"
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

cd "$ACTIVE_DIR"
DB_CONTAINER=$(docker compose ps -q postgres || echo "")
if [ -z "$DB_CONTAINER" ]; then
  echo -e "❌ Error: PostgreSQL container is not running."
  rm -rf "$TEMP_DIR"
  exit 1
fi

# 1. Restore Database Dump
echo -e "\n${BLUE}🔌 Restoring PostgreSQL database...${NC}"
docker cp "$TEMP_DIR/database.sql" "$DB_CONTAINER:/tmp/restore_db.sql"
# Terminate existing connections to allow restore overwrite
docker compose exec -T postgres psql -U blde_admin -d postgres -c "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = 'blde_edc_db' AND pid <> pg_backend_pid();"
docker compose exec -T postgres dropdb -U blde_admin --if-exists blde_edc_db
docker compose exec -T postgres createdb -U blde_admin blde_edc_db
docker compose exec -T postgres pg_restore -U blde_admin -d blde_edc_db -F c "/tmp/restore_db.sql"
docker compose exec -T postgres rm -f "/tmp/restore_db.sql"

# 2. Restore File Attachments
echo -e "${BLUE}📁 Restoring clinical attachments and documents...${NC}"
docker compose cp "$TEMP_DIR/attachments/." backend:/usr/src/app/uploads/

rm -rf "$TEMP_DIR"

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}🎉 DATABASE AND TRIAL RECOVERY SUCCESSFULLY COMPLETED!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
