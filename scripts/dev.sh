#!/bin/bash
# dev.sh — Launch TacSuite development server (Vite)
#
# Usage:
#   ./scripts/dev.sh [LOG_FILE]
#
# Default log file: ./tmp/serve-tacsuite.log
#
# The server runs on http://127.0.0.1:9678 and survives session termination (nohup+disown).
# To kill: pkill -f "vite.*9678"

set -e

# Determine log file location
TACSUITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${1:-/tmp/tacsuite-serve-dev.log}"

# Ensure directory exists
mkdir -p "$(dirname "$LOG_FILE")"

echo "Starting TacSuite development server on 127.0.0.1:9678..."
echo "Log file: $LOG_FILE"

# Check if port is already in use
if ss -ltnp 2>/dev/null | grep -q ':9678.*node'; then
  echo "Port 9678 already in use by Vite — skipping launch"
  PID=$(ss -ltnp 2>/dev/null | grep ':9678.*node' | grep -oP 'pid=\K[0-9]+' | head -1)
  echo "Existing PID: $PID"
  exit 0
fi

# Kill any stray vite processes from previous runs (optional, comment out if not desired)
pkill -f "vite.*9678" 2>/dev/null || true
sleep 1

# Launch dev server from TacSuite root
cd "$TACSUITE_DIR"
nohup npm run dev -- --host 0.0.0.0 > "$LOG_FILE" 2>&1 &
PID=$!
sleep 3

# Disown so it survives session termination
disown

echo "Server started with PID: $PID"
echo "Access at: http://127.0.0.1:9678"

# Wait up to 30 seconds for port to respond
echo "Waiting for server to respond..."
for i in {1..30}; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9678/ 2>/dev/null | grep -q "200"; then
    echo "Server is ready (HTTP 200)"
    exit 0
  fi
  sleep 1
done

echo "Warning: Server did not respond after 30 seconds. Check log: $LOG_FILE"
