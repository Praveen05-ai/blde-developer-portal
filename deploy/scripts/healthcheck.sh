#!/bin/bash
# ==============================================================================
# BLDE EDC — INFRASTRUCTURE DIAGNOSTIC HEALTHCHECK AND MONITORING
# ==============================================================================
set -e

GREEN='\033[0;32m'
NC='\033[0m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'

# Find active deployment
ACTIVE_DIR=""
for dir in "../laptop" "../lab" "../university"; do
  if [ -f "$dir/docker-compose.yml" ] && docker compose -f "$dir/docker-compose.yml" ps --format json | grep -q "running"; then
    ACTIVE_DIR="$dir"
    break
  fi
done

if [ -z "$ACTIVE_DIR" ]; then
  echo -e "${RED}❌ System Status: OFFLINE (No active docker containers found)${NC}"
  exit 1
fi

cd "$(dirname "$0")"
cd "$ACTIVE_DIR"

echo -e "${BLUE}🔍 Diagnosing BLDE EDC Cluster Health...${NC}\n"

# 1. Probe Container Running State
echo -e "Container Statuses:"
docker compose ps

# 2. Check Postgres Database Connectivity
echo -e "\nDatabase Connectivity Check:"
if docker compose exec -T postgres pg_isready -U blde_admin &>/dev/null; then
  echo -e "  PostgreSQL Connection: ${GREEN}OK (Connection accepted)${NC}"
else
  echo -e "  PostgreSQL Connection: ${RED}CRITICAL (Cannot connect to Database container)${NC}"
fi

# 3. Check Backend /api/health Endpoint
echo -e "\nExpress API Server Status Check:"
API_STATUS=$(docker compose exec -T backend wget -qO- http://localhost:3001/api/health || echo "offline")
if [ "$API_STATUS" != "offline" ]; then
  echo -e "  Express Server Gateway: ${GREEN}OK${NC}"
  echo -e "  Details: $API_STATUS"
else
  echo -e "  Express Server Gateway: ${RED}CRITICAL (Server offline/crashed)${NC}"
fi

# 4. Check Upload Mount Disk Usage
echo -e "\nAttachments Upload Volume Check:"
docker compose exec -T backend df -h /usr/src/app/uploads | tail -n 1 | awk '{print "  Storage Capacity Used: " $5 " (" $4 " available on mount)"}'

echo -e "\n${GREEN}Diagnostic completed.${NC}"
