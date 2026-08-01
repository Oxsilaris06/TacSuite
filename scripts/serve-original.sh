#!/bin/bash
# serve-original.sh — Launch original GStart-main server (reference for baselines)
#
# Usage:
#   ./scripts/serve-original.sh [LOG_FILE]
#
# Default log file: ./tmp/serve-original.log
#
# The server runs on http://127.0.0.1:9679 and survives session termination (nohup+disown).
# To kill: pkill -f "http.server 9679"

set -e

# Determine log file location
LOG_FILE="${1:-/tmp/tacsuite-serve-original.log}"
GSTART_DIR="/home/nico/Bureau/Web/GStart-main"

# Ensure directory exists
mkdir -p "$(dirname "$LOG_FILE")"

echo "Starting original server from $GSTART_DIR on 127.0.0.1:9679..."
echo "Log file: $LOG_FILE"

# Check if port is already in use
if ss -ltnp 2>/dev/null | grep -q ':9679.*python3'; then
  echo "Port 9679 already in use by http.server — skipping launch"
  PID=$(ss -ltnp 2>/dev/null | grep ':9679.*python3' | grep -oP 'pid=\K[0-9]+' | head -1)
  echo "Existing PID: $PID"
  exit 0
fi

# Launch server from GStart-main root
cd "$GSTART_DIR"
nohup python3 -m http.server 9679 --bind 127.0.0.1 > "$LOG_FILE" 2>&1 &
PID=$!
sleep 1

# Disown so it survives session termination
disown

echo "Server started with PID: $PID"
echo "Access at: http://127.0.0.1:9679"
