#!/bin/bash
# ==============================================================================
# BLDE EDC — MULTI-TIER PLATFORM DIAGNOSTICS & SYSTEM VALIDATION UTILITY
# ==============================================================================
set -e

GREEN='\033[0;32m'
NC='\033[0m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'

REPORT_FILE="diagnostic_report.txt"
# Clear existing report
echo "==============================================================================" > "$REPORT_FILE"
echo "           BLDE(DU) Clinical Research Platform — Diagnostic Report            " >> "$REPORT_FILE"
echo "           Generated: $(date)" >> "$REPORT_FILE"
echo "==============================================================================" >> "$REPORT_FILE"

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
  echo "[INFO] $1" >> "$REPORT_FILE"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
  echo "[PASS] $1" >> "$REPORT_FILE"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
  echo "[WARN] $1" >> "$REPORT_FILE"
}

log_error() {
  echo -e "${RED}[FAIL]${NC} $1" >&2
  echo "[FAIL] $1" >> "$REPORT_FILE"
}

cd "$(dirname "$0")"

log_info "Initiating system preflight check..."

# 1. Probe Docker & Docker Compose
log_info "Probing Docker daemon and Docker Compose CLI..."
if command -v docker &>/dev/null; then
  DOCKER_VER=$(docker --version)
  log_success "Docker CLI detected: $DOCKER_VER"
  
  if docker info &>/dev/null; then
    log_success "Docker daemon is active and responding."
  else
    log_error "Docker daemon is NOT running. Please launch Docker Desktop or systemd docker.service."
    exit 1
  fi
else
  log_error "Docker CLI is not found on PATH."
  exit 1
fi

if docker compose version &>/dev/null; then
  log_success "Docker Compose v2 CLI detected: $(docker compose version)"
elif command -v docker-compose &>/dev/null; then
  log_success "Docker-Compose standalone CLI detected: $(docker-compose --version)"
else
  log_error "Docker Compose was not found. Please install docker-compose."
  exit 1
fi

# 2. Detect Active Orchestration Mode
log_info "Scanning for active local container orchestration..."
ACTIVE_DIR=""
ACTIVE_TIER=""
for tier in "laptop" "lab" "university"; do
  dir="../$tier"
  if [ -f "$dir/docker-compose.yml" ]; then
    # Check if there are active running containers in this tier
    if docker compose -f "$dir/docker-compose.yml" ps --format json | grep -q "running"; then
      ACTIVE_DIR="$dir"
      ACTIVE_TIER="$tier"
      break
    fi
  fi
done

if [ -z "$ACTIVE_DIR" ]; then
  log_warn "No running BLDE EDC docker containers detected."
  log_warn "Defaulting checks to the Laptop folder: '../laptop'..."
  ACTIVE_DIR="../laptop"
  ACTIVE_TIER="laptop"
else
  log_success "Detected active running deployment tier: ${ACTIVE_TIER} (${ACTIVE_DIR})"
fi

# Switch context to active folder
cd "$ACTIVE_DIR"

# 3. Environment Config Checks
log_info "Validating environment configuration (.env)..."
if [ ! -f .env ]; then
  log_error "Missing environment configuration file: $(pwd)/.env"
  echo "Action: Copy .env.example to .env and fill in active parameters." >> "$REPORT_FILE"
else
  log_success "Found active .env configuration file."
  
  # Check for critical variables
  source .env || true
  CRIT_VARS=("JWT_SECRET" "DB_USER" "DB_PASSWORD" "DB_NAME")
  missing_vars=0
  for var in "${CRIT_VARS[@]}"; do
    val=$(grep -E "^${var}=" .env | cut -d'=' -f2- || echo "")
    if [ -z "$val" ]; then
      log_error "Missing required environment variable: $var"
      missing_vars=$((missing_vars + 1))
    fi
  done
  
  if [ "$missing_vars" -eq 0 ]; then
    log_success "All required environment variables are populated."
  fi
fi

# 4. Port Mappings Check
log_info "Probing target host network ports..."
check_port() {
  local port=$1
  local name=$2
  (exec 3<>/dev/tcp/127.0.0.1/$port) &>/dev/null && {
    exec 3>&-
    log_success "Port $port ($name): Active (Receiving connections)"
    return 0
  }
  log_warn "Port $port ($name): Offline / Blocked"
  return 1
}

case $ACTIVE_TIER in
  laptop)
    check_port 80 "Nginx HTTP Proxy"
    check_port 5432 "PostgreSQL Database"
    ;;
  lab)
    check_port 8080 "LAN HTTP Proxy"
    check_port 5432 "PostgreSQL Database"
    ;;
  university)
    check_port 80 "HTTP Redirector"
    check_port 443 "HTTPS Secure Gateway"
    check_port 9000 "MinIO Object Storage API"
    check_port 9001 "MinIO Administration Console"
    check_port 8042 "Orthanc PACS Web Portal"
    check_port 5432 "PostgreSQL Database"
    ;;
esac

# 5. Database Socket and Knex Migration Verification
log_info "Checking PostgreSQL connection status inside containers..."
DB_CONTAINER=$(docker compose ps -q postgres 2>/dev/null || echo "")
if [ -n "$DB_CONTAINER" ]; then
  if docker compose exec -T postgres pg_isready -U "${DB_USER:-blde_admin}" &>/dev/null; then
    log_success "PostgreSQL server is healthy and accepting socket connections."
    
    # Probe migration status using backend CLI
    log_info "Verifying database migrations state..."
    MIG_STATUS=$(docker compose exec -T backend npx knex migrate:status --knexfile knexfile.js 2>/dev/null || echo "failed")
    if [[ "$MIG_STATUS" == *"failed"* ]]; then
      log_warn "Could not read migration states. Ensure backend server is fully migrated."
    else
      echo -e "$MIG_STATUS" >> "$REPORT_FILE"
      log_success "Database migrations verified successfully."
    fi
  else
    log_error "PostgreSQL socket connection refused inside container."
  fi
else
  log_warn "PostgreSQL database container is offline."
fi

# 6. Storage Disk Space and Mount Write Checks
log_info "Evaluating volume attachments storage spaces..."
docker compose exec -T backend df -h /usr/src/app/uploads &> /tmp/disk_df.txt || true
if [ -f /tmp/disk_df.txt ]; then
  disk_info=$(tail -n 1 /tmp/disk_df.txt | awk '{print "Space Used: " $5 ", Available space: " $4}')
  log_success "Attachments directory mount stats: $disk_info"
  rm -f /tmp/disk_df.txt
else
  log_warn "Unable to query attachments volume disk space."
fi

log_info "Testing upload volume write capabilities..."
if docker compose exec -T backend touch /usr/src/app/uploads/.diagnostic_write_probe &>/dev/null; then
  log_success "Upload folder has active read-write capabilities (mount bind is healthy)."
  docker compose exec -T backend rm -f /usr/src/app/uploads/.diagnostic_write_probe
else
  log_error "Uploads volume is READ-ONLY or lacks permission bindings. Researchers will fail attachment submissions."
fi

# 7. Backup Folder Check
log_info "Probing backups volume access..."
BACKUPS_DIR="../../backups"
if [ -d "$BACKUPS_DIR" ]; then
  if touch "$BACKUPS_DIR/.diagnostic_write_probe" &>/dev/null; then
    log_success "Backups folder exists and is writable."
    rm -f "$BACKUPS_DIR/.diagnostic_write_probe"
  else
    log_warn "Backups directory exists but write permissions are restricted."
  fi
else
  log_warn "Backups directory ('$BACKUPS_DIR') does not exist yet. Running backup.sh will create it automatically."
fi

# 8. Service Integrations Diagnostics (University preset)
if [ "$ACTIVE_TIER" = "university" ]; then
  log_info "Probing MinIO and Orthanc integrations health..."
  
  # MinIO API check
  if docker compose exec -T backend wget -qO- http://minio:9000/minio/health/live &>/dev/null; then
    log_success "MinIO S3 API endpoint is online and responding."
  else
    log_error "MinIO S3 API connection failed. File attachments will fail uploads."
  fi

  # Orthanc PACS DICOM check
  if docker compose exec -T backend wget -qO- http://orthanc:8042/ &>/dev/null; then
    log_success "Orthanc PACS DICOM server is online."
  else
    log_warn "Orthanc PACS server is offline or unreachable."
  fi
  
  # SSL Certificate Checks
  log_info "Probing university SSL certificates..."
  if [ -d "./certs" ] && [ -n "$(ls -A "./certs" 2>/dev/null)" ]; then
    log_success "Found SSL certificates mapping inside './certs/'."
  else
    log_warn "University SSL certificate mounts are empty. Certbot SSL validation may be required."
  fi
fi

# 9. Dump Container Health Summary
echo -e "\n==============================================================================" >> "$REPORT_FILE"
echo "                       Container Status Summary Summary                       " >> "$REPORT_FILE"
echo "==============================================================================" >> "$REPORT_FILE"
docker compose ps >> "$REPORT_FILE"

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}🎉 SYSTEM DIAGNOSTICS LOGGED SUCCESSFULLY!${NC}"
echo -e "Report saved to: ${BLUE}$(pwd)/$REPORT_FILE${NC}"
echo -e "${GREEN}==============================================================================${NC}"
