#!/usr/bin/env bash
# Brings every MediTrust service online with one command, handling the two
# things that have repeatedly broken manual startup this project:
#   1. Stale LAN IP in *_AGENT_PUBLIC_ENDPOINT (changes whenever the network
#      does; agents load .env once at boot, so a stale value silently breaks
#      phone connectivity until the next restart).
#   2. Stale cross-agent credDef env vars (ISSUER_CRED_DEF_ID,
#      DOCTOR_MEDICAL_CRED_DEF_ID) — each agent mints a fresh, random credDef
#      on every boot, so doctor/pharmacy's identity/prescription verification
#      silently breaks unless these are re-copied after every government/
#      doctor restart. This exact failure reproduced live on 2026-07-25.
#
# Written for bash 3.2 (macOS's default, no associative-array support) —
# deliberately avoids `declare -A`; result tracking uses eval-based
# indirection instead (RESULT_<name>=<status>).
#
# Usage: npm run dev:all   (or: bash scripts/start-all.sh)

set -uo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"
WEB_ENV_FILE="apps/web/.env.local"
LOG_DIR="/tmp/meditrust-logs"
mkdir -p "$LOG_DIR"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

log() { echo -e "$1"; }
# Service names can contain hyphens (backup-provider), which aren't valid in
# bash identifiers — sanitize before using as part of an eval'd variable name.
varname() { echo "$1" | tr '-' '_'; }
set_result() { v=$(varname "$1"); eval "RESULT_${v}=\"\$2\""; }
get_result() { v=$(varname "$1"); eval "echo \"\${RESULT_${v}:-not started}\""; }

# ---------------------------------------------------------------------------
# Step -1: check (and auto-fix) the bundled BCovrin genesis before anything
# else — a stale genesis silently breaks every ledger operation and looks
# identical to a real network block (this cost this project weeks of
# misdiagnosis before the real cause was found 2026-07-22). Never blocks
# startup if the check itself can't run (offline, etc.) — it just warns.
# ---------------------------------------------------------------------------
node scripts/check-genesis.js || true

# ---------------------------------------------------------------------------
# Step 0: refresh the LAN IP in .env if it's changed since last written.
# ---------------------------------------------------------------------------
CURRENT_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "")
if [ -n "$CURRENT_IP" ]; then
  STALE_IP=$(grep -oE 'ISSUER_AGENT_PUBLIC_ENDPOINT=http://[0-9.]+' "$ENV_FILE" 2>/dev/null | grep -oE '[0-9.]+' | head -1)
  if [ -n "$STALE_IP" ] && [ "$STALE_IP" != "$CURRENT_IP" ]; then
    log "${YELLOW}LAN IP changed ($STALE_IP -> $CURRENT_IP) — updating .env${NC}"
    sed -i '' "s/$STALE_IP/$CURRENT_IP/g" "$ENV_FILE"
  else
    log "LAN IP OK ($CURRENT_IP)"
  fi

  # apps/web/.env.local tracks the same LAN IP independently (Next.js reads
  # its own env file, separate from the root .env agents read) — it drifted
  # out of sync with .env at least once in practice (2026-07-25), so refresh
  # it here too rather than assuming the two stay in lockstep.
  WEB_STALE_IP=$(grep -oE 'NEXT_PUBLIC_GOVERNMENT_URL=http://[0-9.]+' "$WEB_ENV_FILE" 2>/dev/null | grep -oE '[0-9.]+' | head -1)
  if [ -n "$WEB_STALE_IP" ] && [ "$WEB_STALE_IP" != "$CURRENT_IP" ]; then
    log "${YELLOW}LAN IP changed ($WEB_STALE_IP -> $CURRENT_IP) — updating $WEB_ENV_FILE${NC}"
    sed -i '' "s/$WEB_STALE_IP/$CURRENT_IP/g" "$WEB_ENV_FILE"
  fi
else
  log "${YELLOW}Could not read en0's IP — skipping LAN IP refresh (fine if you're not testing from a phone)${NC}"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

start_service() {
  name=$1; script=$2; port=$3
  logfile="$LOG_DIR/$name.log"
  if port_in_use "$port"; then
    log "${YELLOW}$name: port $port already in use — assuming it's already running, not starting a second copy${NC}"
    set_result "$name" "already running"
    return
  fi
  rm -f "$logfile"
  nohup npm run "$script" > "$logfile" 2>&1 &
  echo $! > "$LOG_DIR/$name.pid"
  log "Starting $name (port $port)..."
}

wait_for_log() {
  logfile=$1; pattern=$2; timeout=$3
  waited=0
  while [ "$waited" -lt "$timeout" ]; do
    grep -q "$pattern" "$logfile" 2>/dev/null && return 0
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

wait_for_port() {
  port=$1; timeout=$2
  waited=0
  while [ "$waited" -lt "$timeout" ]; do
    port_in_use "$port" && return 0
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

confirm_ready() {
  name=$1; pattern=${2:-"routes mounted. Ready."}; timeout=${3:-90}
  if [ "$(get_result "$name")" = "already running" ]; then return; fi
  if wait_for_log "$LOG_DIR/$name.log" "$pattern" "$timeout"; then
    log "${GREEN}$name ready${NC}"
    set_result "$name" "ready"
  else
    log "${RED}$name did not report ready within ${timeout}s — check $LOG_DIR/$name.log${NC}"
    set_result "$name" "TIMED OUT"
  fi
}

update_env_var() {
  key=$1; value=$2
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# ---------------------------------------------------------------------------
# Step 1: services with no cross-agent credDef dependency — start immediately.
# ---------------------------------------------------------------------------
start_service dwn dwn:dev 5050
start_service sss sss:dev 4008
start_service backup-provider backup-provider:dev 4010
start_service gov gov:dev 4000
start_service ha ha:dev 4006

confirm_ready dwn "listening on" 30
confirm_ready sss "listening on" 30
confirm_ready backup-provider "listening on" 30
confirm_ready gov
confirm_ready ha

# ---------------------------------------------------------------------------
# Step 2: government is up — pull its fresh identity credDef into .env
# before starting doctor/pharmacy, which both need it.
# ---------------------------------------------------------------------------
ISSUER_CRED_DEF=$(grep "Government schema + credential definition registered:" "$LOG_DIR/gov.log" 2>/dev/null | tail -1 | sed 's/.*registered: //')
if [ -n "$ISSUER_CRED_DEF" ]; then
  update_env_var ISSUER_CRED_DEF_ID "$ISSUER_CRED_DEF"
  log "Updated ISSUER_CRED_DEF_ID -> ...${ISSUER_CRED_DEF: -20}"
else
  log "${YELLOW}Could not read government's identity credDef from its log — doctor/pharmacy identity verification may fail against a stale value${NC}"
fi

# ---------------------------------------------------------------------------
# Step 3: doctor needs the fresh ISSUER_CRED_DEF_ID just written above.
# ---------------------------------------------------------------------------
start_service doctor doctor:dev 4002
confirm_ready doctor

DOCTOR_CRED_DEF=$(grep "Doctor schema + credential definition registered:" "$LOG_DIR/doctor.log" 2>/dev/null | tail -1 | sed 's/.*registered: //')
if [ -n "$DOCTOR_CRED_DEF" ]; then
  update_env_var DOCTOR_MEDICAL_CRED_DEF_ID "$DOCTOR_CRED_DEF"
  log "Updated DOCTOR_MEDICAL_CRED_DEF_ID -> ...${DOCTOR_CRED_DEF: -20}"
else
  log "${YELLOW}Could not read doctor's medical credDef from its log — pharmacy's prescription verification may fail against a stale value${NC}"
fi

# ---------------------------------------------------------------------------
# Step 4: pharmacy needs both credDefs just written above.
# ---------------------------------------------------------------------------
start_service pharmacy pharmacy:dev 4004
confirm_ready pharmacy

# ---------------------------------------------------------------------------
# Step 5: the web app (independent of everything above).
# ---------------------------------------------------------------------------
if port_in_use 3001; then
  log "${YELLOW}web: port 3001 already in use — assuming it's already running${NC}"
  set_result web "already running"
else
  rm -f "$LOG_DIR/web.log"
  (cd apps/web && nohup npm run dev > "$LOG_DIR/web.log" 2>&1 &)
  log "Starting web app (port 3001)..."
fi
if [ "$(get_result web)" != "already running" ]; then
  if wait_for_port 3001 30; then
    log "${GREEN}web ready${NC}"
    set_result web "ready"
  else
    log "${RED}web app did not come up within 30s — check $LOG_DIR/web.log${NC}"
    set_result web "TIMED OUT"
  fi
fi

# ---------------------------------------------------------------------------
# Final status
# ---------------------------------------------------------------------------
echo ""
log "${BOLD}== Status ==${NC}"
printf "%-18s %-6s %-14s\n" "SERVICE" "PORT" "STATUS"
for entry in "dwn:5050" "gov:4000" "ha:4006" "doctor:4002" "pharmacy:4004" "sss:4008" "backup-provider:4010" "web:3001"; do
  name="${entry%%:*}"; port="${entry##*:}"
  status="$(get_result "$name")"
  case "$status" in
    ready) color="$GREEN" ;;
    "already running") color="$YELLOW" ;;
    *) color="$RED" ;;
  esac
  printf "%-18s %-6s ${color}%-14s${NC}\n" "$name" "$port" "$status"
done

echo ""
echo "Logs: $LOG_DIR/<service>.log   PIDs: $LOG_DIR/<service>.pid"
echo "To stop everything: npm run stop:all"
