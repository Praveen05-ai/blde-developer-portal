#!/bin/bash
# ==============================================================================
# BLDE EDC — MULTI-TIER PLATFORM INSTALLATION AUTOMATION
# ==============================================================================
set -e

GREEN='\033[0;32m'
NC='\033[0m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}           BLDE(DU) Clinical Research Platform — Deployment Installer         ${NC}"
echo -e "${BLUE}==============================================================================${NC}"

# Verify system prerequisites
check_dep() {
  local cmd=$1
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${RED}❌ Missing Dependency: '$cmd' is not installed or not in PATH.${NC}" >&2
    return 1
  fi
  return 0
}

echo -e "🔍 Scanning host system prerequisites..."
has_deps=true
check_dep "docker" || has_deps=false
check_dep "openssl" || has_deps=false
check_dep "sed" || has_deps=false

# Check docker compose support
if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
  echo -e "${RED}❌ Missing Dependency: docker-compose v2 is not installed.${NC}" >&2
  has_deps=false
fi

if [ "$has_deps" = false ]; then
  echo -e "${RED}❌ Preflight Failure: Missing one or more critical path utilities. Please install dependencies and retry.${NC}"
  exit 1
fi
echo -e "${GREEN}  Pre-requisites: OK (All standard command line tools present)${NC}"

# Prompt for Deployment Mode
echo -e "\nChoose your target deployment mode:"
echo -e "  [1] Single User Laptop Mode (Local host, postgres, zero-configuration)"
echo -e "  [2] Research Lab / Department Mode (LAN exposed, PostgreSQL on 8080)"
echo -e "  [3] University / Institute Mode (Ubuntu Server, Nginx SSL, MinIO S3, Orthanc PACS)"
echo -e "  [4] Enterprise Cloud Mode (Stateless node, remote RDS PostgreSQL, external AWS S3)"
read -rp "Enter selection [1-4]: " modeSelection

DEPLOY_DIR=""
case $modeSelection in
  1)
    echo -e "\nInitializing ${GREEN}Single User Laptop Mode${NC}..."
    DEPLOY_DIR="../laptop"
    ;;
  2)
    echo -e "\nInitializing ${GREEN}Research Lab / Department Mode${NC}..."
    DEPLOY_DIR="../lab"
    ;;
  3)
    echo -e "\nInitializing ${GREEN}University / Institute Mode${NC}..."
    DEPLOY_DIR="../university"
    ;;
  4)
    echo -e "\nInitializing ${GREEN}Enterprise Cloud Mode${NC}..."
    DEPLOY_DIR="../enterprise"
    ;;
  *)
    echo -e "${RED}❌ Invalid selection. Exiting installer.${NC}"
    exit 1
    ;;
esac

# Check if a port is locked
is_port_in_use() {
  local port=$1
  # Method 1: native bash tcp socket check (extremely fast, zero-dependency)
  (exec 3<>/dev/tcp/127.0.0.1/$port) &>/dev/null && { exec 3>&-; return 0; }
  
  # Method 2: ss or netstat as backup
  if command -v ss &>/dev/null; then
    ss -tuln | grep -q ":$port " && return 0
  elif command -v netstat &>/dev/null; then
    netstat -an | grep -q ":$port " && return 0
  fi
  return 1
}

# Dynamic Port Collision checking based on selection
echo -e "\n🔍 Scanning host target ports for conflicts..."
PORTS_TO_CHECK=()
case $modeSelection in
  1) PORTS_TO_CHECK=(80 5432) ;;
  2) PORTS_TO_CHECK=(8080 5432) ;;
  3) PORTS_TO_CHECK=(80 443 9000 9001 8042 5432) ;;
  4) PORTS_TO_CHECK=(3001) ;;
esac

conflict_found=false
for port in "${PORTS_TO_CHECK[@]}"; do
  if is_port_in_use "$port"; then
    echo -e "${RED}⚠️  PORT COLLISION: Port ${port} is currently in use on this host.${NC}"
    echo -e "   Why this matters: Docker Compose cannot bind to port ${port} because another local service or process is using it."
    if [ "$port" -eq 80 ] || [ "$port" -eq 8080 ] || [ "$port" -eq 443 ]; then
      echo -e "   Possible Conflicting Service: Local IIS, Apache, Skype, nginx, or active Docker container."
      echo -e "   Recommended Action: Stop the conflicting web service or edit your target '.env' file configuration."
    elif [ "$port" -eq 5432 ]; then
      echo -e "   Possible Conflicting Service: A local active PostgreSQL instance."
      echo -e "   Recommended Action: Stop the local postgres service ('pg_ctl stop' or Windows Services panel) or change port maps in '.env'."
    fi
    conflict_found=true
  fi
done

if [ "$conflict_found" = true ]; then
  echo -e "\n${RED}❌ Installation Halted: Port conflict detected. Deterministic deployments require unique free ports.${NC}"
  echo -e "Please resolve the locks above or adjust your target '.env' file before resuming."
  exit 1
fi
echo -e "${GREEN}  Port Scan: OK (All target ports free)${NC}"

cd "$(dirname "$0")"
cd "$DEPLOY_DIR"

# Copy Environment configs
if [ ! -f .env ]; then
  echo -e "Provisions: Copying '.env.example' to '.env'..."
  cp .env.example .env
  
  # Inject random JWT Secret automatically
  RAND_SECRET=$(openssl rand -base64 24 || echo "blde_edc_random_secret_fallback_9921")
  sed -i.bak "s/JWT_SECRET=.*/JWT_SECRET=$RAND_SECRET/g" .env && rm -f .env.bak
  
  echo -e "${YELLOW}📝 Created '.env' with secure session keys. You can edit this file to configure database or SMTP credentials.${NC}"
fi

# Spin up containers
echo -e "\n${BLUE}🚀 Starting Docker Services...${NC}"
docker compose up -d --build

echo -e "\n⏳ Waiting for the database container to become healthy..."
sleep 8

# Execute database migrations
echo -e "\n${BLUE}⚙️ Executing Knex Database Migrations...${NC}"
docker compose exec -T backend npm run migrate:latest

# Run database seeds to populate default accounts
echo -e "\n${BLUE}🌱 Seeding default initial datasets...${NC}"
docker compose exec -T backend npx knex seed:run --knexfile knexfile.js

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}🎉 INSTALLATION COMPLETED SUCCESSFULLY!${NC}"
if [ "$modeSelection" -eq 1 ]; then
  echo -e "Platform is running in Laptop Mode. Open: ${BLUE}http://localhost${NC} in your browser."
elif [ "$modeSelection" -eq 2 ]; then
  echo -e "Platform is running in LAN Lab Mode. Open: ${BLUE}http://<Your_LAN_IP>:8080${NC}"
elif [ "$modeSelection" -eq 3 ]; then
  echo -e "Platform is running in Campus Server Mode. Exposed on ${BLUE}http://blde-edc.org${NC}"
else
  echo -e "Platform is running in Enterprise Cloud Mode."
fi
echo -e "${GREEN}==============================================================================${NC}"
