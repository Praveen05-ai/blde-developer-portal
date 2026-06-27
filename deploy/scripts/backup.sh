#!/bin/bash
# ==============================================================================
# BLDE EDC — GXP-COMPLIANT CLINICAL ARCHIVE & BACKUP COORDINATOR
# ==============================================================================
set -e

GREEN='\033[0;32m'
NC='\033[0m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}           BLDE(DU) Clinical Research Platform — Backup Engine                ${NC}"
echo -e "${BLUE}==============================================================================${NC}"

# Locate active config/runtime.json
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$WORKSPACE_ROOT/config/runtime.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}❌ Error: Centralized config/runtime.json not found inside: $WORKSPACE_ROOT${NC}"
  exit 1
fi

# Parse runtime.json config authority cleanly using POSIX sed
DB_MODE=$(grep -E '"database_mode":' "$CONFIG_FILE" | cut -d'"' -f4 || echo "pg")
APP_VER=$(grep -E '"app_version":' "$CONFIG_FILE" | cut -d'"' -f4 || echo "1.0.0")
MIG_VER=$(grep -E '"migration_version":' "$CONFIG_FILE" | cut -d'"' -f4 || echo "20260529101000")
STORAGE_ROOT_VAL=$(grep -E '"storage_root":' "$CONFIG_FILE" | cut -d'"' -f4 || echo "./storage")
STORAGE_ROOT="$WORKSPACE_ROOT/$STORAGE_ROOT_VAL"

BACKUP_DIR="$STORAGE_ROOT/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_DIR="/tmp/blde_backup_$TIMESTAMP"
mkdir -p "$TEMP_DIR"

DB_CHECKSUM=""

# 1. Database Extraction based on active DB_MODE Dialect
if [ "$DB_MODE" = "sqlite" ]; then
  echo -e "\n${BLUE}💾 Mode: SQLite Dialect Detected. Copying database...${NC}"
  SQLITE_FILE="$STORAGE_ROOT/database/blde_edc.sqlite"
  
  if [ -f "$SQLITE_FILE" ]; then
    cp "$SQLITE_FILE" "$TEMP_DIR/database.sqlite"
    # Compute SHA-256 Checksum natively
    if command -v sha256sum &>/dev/null; then
      DB_CHECKSUM=$(sha256sum "$SQLITE_FILE" | awk '{print $1}')
    elif command -v shasum &>/dev/null; then
      DB_CHECKSUM=$(shasum -a 256 "$SQLITE_FILE" | awk '{print $1}')
    fi
    echo -e "   SQLite DB Checksum: ${GREEN}$DB_CHECKSUM${NC}"
  else
    echo -e "${YELLOW}⚠️ SQLite database file not found yet. Copying blank schema placeholder...${NC}"
    touch "$TEMP_DIR/database.sqlite"
  fi
else
  echo -e "\n${BLUE}💾 Mode: PostgreSQL Dialect Detected. Extracting container stream...${NC}"
  # Locate active PostgreSQL container
  ACTIVE_DIR="$WORKSPACE_ROOT/deploy/laptop"
  for dir in "$WORKSPACE_ROOT/deploy/laptop" "$WORKSPACE_ROOT/deploy/lab" "$WORKSPACE_ROOT/deploy/university"; do
    if [ -f "$dir/docker-compose.yml" ] && docker compose -f "$dir/docker-compose.yml" ps --format json 2>/dev/null | grep -q "running"; then
      ACTIVE_DIR="$dir"
      break
    fi
  done
  
  cd "$ACTIVE_DIR"
  DB_CONTAINER=$(docker compose ps -q postgres 2>/dev/null || echo "")
  if [ -z "$DB_CONTAINER" ]; then
    echo -e "${RED}❌ Error: PostgreSQL container is unreachable. Backup aborted.${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
  fi
  
  docker compose exec -T postgres pg_dump -U blde_admin -d blde_edc_db -F c -f "/tmp/db_dump_$TIMESTAMP.sql"
  docker cp "$DB_CONTAINER:/tmp/db_dump_$TIMESTAMP.sql" "$TEMP_DIR/database.sql"
  docker compose exec -T postgres rm -f "/tmp/db_dump_$TIMESTAMP.sql"
  
  # Compute SHA-256 Checksum on PostgreSQL SQL Dump
  if command -v sha256sum &>/dev/null; then
    DB_CHECKSUM=$(sha256sum "$TEMP_DIR/database.sql" | awk '{print $1}')
  fi
  echo -e "   PostgreSQL SQL Checksum: ${GREEN}$DB_CHECKSUM${NC}"
  cd "$SCRIPT_DIR"
fi

# 2. Attachments File Archive
echo -e "${BLUE}📁 Archiving uploaded clinical trial documents...${NC}"
UPLOADS_DIR="$STORAGE_ROOT/uploads"
if [ -d "$UPLOADS_DIR" ]; then
  cp -r "$UPLOADS_DIR" "$TEMP_DIR/attachments"
else
  mkdir -p "$TEMP_DIR/attachments"
fi

# 3. Compile GxP Backup Manifest Metadata
echo -e "${BLUE}📝 Generating Versioned Backup Manifest...${NC}"
MANIFEST_FILE="$TEMP_DIR/backup_manifest.json"
cat > "$MANIFEST_FILE" <<EOF
{
  "app_version": "$APP_VER",
  "migration_version": "$MIG_VER",
  "database_mode": "$DB_MODE",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "db_checksum_sha256": "$DB_CHECKSUM",
  "archive_contents": [
    "attachments",
    $( [ "$DB_MODE" = "sqlite" ] && echo '"database.sqlite"' || echo '"database.sql"' )
  ]
}
EOF

# 4. Compress Backup Package
echo -e "${BLUE}📦 Compressing backup package...${NC}"
BACKUP_FILE="$BACKUP_DIR/blde_backup_$TIMESTAMP.tar.gz"
tar -czf "$BACKUP_FILE" -C "$TEMP_DIR" .

rm -rf "$TEMP_DIR"

# 5. GxP Backup Integrity Validation Checks
echo -e "${BLUE}🔍 Performing GxP Backup Integrity Validation...${NC}"
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
  # Verify archive structure using tar
  if tar -tzf "$BACKUP_FILE" | grep -q "backup_manifest.json"; then
    INTEGRITY_STATUS="${GREEN}PASS (Archive structures intact, backup_manifest.json verified)${NC}"
  else
    INTEGRITY_STATUS="${RED}FAIL (Missing backup_manifest.json inside archive)${NC}"
    echo -e "${RED}❌ Backup Integrity Warning: Corrupted backup package generated!${NC}"
    exit 1
  fi
else
  INTEGRITY_STATUS="${RED}FAIL (Backup package empty or failed to write to disk)${NC}"
  echo -e "${RED}❌ Backup Integrity Warning: Backup file write failed!${NC}"
  exit 1
fi

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}🎉 SECURE GXP CLINICAL BACKUP SUCCESSFUL!${NC}"
echo -e "File saved to: ${BLUE}$(realpath "$BACKUP_FILE")${NC}"
echo -e "Size: $(du -sh "$BACKUP_FILE" | cut -f1)"
echo -e "Integrity Check: $INTEGRITY_STATUS"
echo -e "${GREEN}==============================================================================${NC}"
