#!/usr/bin/env bash
# Stops every service started by scripts/start-all.sh, using the PID files
# it wrote. Falls back to killing by port for anything started another way
# (e.g. manually, or a leftover from a previous session).
#
# Written for bash 3.2 (macOS's default) — no associative arrays.
#
# Usage: npm run stop:all   (or: bash scripts/stop-all.sh)

cd "$(dirname "$0")/.."

LOG_DIR="/tmp/meditrust-logs"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

# Check-only — no point auto-fixing a stale genesis on the way down, since
# nothing will be running to use the fix. Just a heads-up for next time.
node scripts/check-genesis.js --check-only || true

for entry in "dwn:5050" "gov:4000" "ha:4006" "doctor:4002" "pharmacy:4004" "sss:4008" "backup-provider:4010" "web:3001"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  stopped=0

  pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill "$pid" 2>/dev/null; then
      stopped=1
    fi
    rm -f "$pidfile"
  fi

  # Catch anything still holding the port (the web app in particular spawns
  # a child process whose PID differs from the one nohup reported).
  port_pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$port_pids" ]; then
    echo "$port_pids" | xargs kill 2>/dev/null
    stopped=1
  fi

  if [ $stopped -eq 1 ]; then
    echo -e "${GREEN}$name (port $port) stopped${NC}"
  else
    echo -e "${YELLOW}$name (port $port) was not running${NC}"
  fi
done

echo "Done."
