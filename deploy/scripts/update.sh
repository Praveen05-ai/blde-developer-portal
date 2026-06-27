#!/bin/bash
# ==============================================================================
# BLDE EDC — MULTI-TIER PLATFORM SAFE UPDATES ENGINE
# ==============================================================================
set -e

GREEN='\033[0;32m'
NC='\033[0m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}           BLDE(DU) Clinical Research Platform — Safe Updates Engine          ${NC}"
echo -e "${BLUE}==============================================================================${NC}"

# Find active deployment folder containing compose file
ACTIVE_DIR=""
for dir in "../laptop" "../lab" "../university" "../enterprise"; do
  if [ -f "$dir/docker-compose.yml" ] && docker compose -f "$dir/docker-compose.yml" ps --format json | grep -q "running"; then
    ACTIVE_DIR="$dir"
    break
  fi
done

if [ -z "$ACTIVE_DIR" ]; then
  echo -e "${YELLOW}⚠️ No active docker containers detected. Defaulting to current folder check...${NC}"
  if [ -f "./docker-compose.yml" ]; then
    ACTIVE_DIR="."
  else
    echo -e "❌ Error: Could not locate active docker compose directory. Please run inside /deploy/scripts/."
    exit 1
  fi
fi

echo -e "Target Directory: ${BLUE}$ACTIVE_DIR${NC}"
cd "$(dirname "$0")"
cd "$ACTIVE_DIR"

echo -e "\n${BLUE}🔄 Pulling latest container images & rebuilding...${NC}"
docker compose pull
docker compose up -d --build

echo -e "\n${BLUE}⚙️ Running database schema migrations...${NC}"
docker compose exec -T backend npm run migrate:latest

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}🎉 PLATFORM SUCCESSFULLY UPDATED AND RUNNING!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
