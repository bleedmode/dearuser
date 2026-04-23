#!/usr/bin/env bash
# reload-dashboard.sh — kill any running Dear User dashboard process, then
# start a fresh one from the freshly-built dist/.
#
# Addresses the known footgun (see project memory
# `project_dashboard_standalone_restart`): the dashboard runs as a detached
# child process, so `npm run build` alone does not pick up new code — a
# stale bundle keeps serving until someone restarts it by hand.
#
# Usage:
#   npm run dashboard:reload      (after npm run build)
#   npm run build:reload          (build + reload in one step)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_ENTRY="$MCP_DIR/dist/dashboard-standalone.js"

if [[ ! -f "$DIST_ENTRY" ]]; then
  echo "[reload-dashboard] $DIST_ENTRY not found — run 'npm run build' first." >&2
  exit 1
fi

# Kill ALL processes listening on the dashboard's port range (7700..7710).
# Uses SIGKILL because SIGTERM-trapping processes (or stdio MCP instances
# that also bound the port) can linger and keep serving stale code — we've
# been burned multiple times by ghost processes serving old bundles.
#
# `lsof -ti :PORT` can return multiple PIDs per port (race conditions,
# SO_REUSEPORT, or smoke-test leftovers). `kill -9` handles any count.
KILLED=0
for PORT in 7700 7701 7702 7703 7704 7705 7706 7707 7708 7709 7710; do
  PIDS="$(lsof -ti :"$PORT" 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    # shellcheck disable=SC2086  # intentional word-splitting for multi-PID kill
    kill -9 $PIDS 2>/dev/null || true
    COUNT=$(echo "$PIDS" | wc -w | tr -d ' ')
    KILLED=$((KILLED + COUNT))
  fi
done

if [[ "$KILLED" -gt 0 ]]; then
  echo "[reload-dashboard] killed $KILLED stale process(es)"
  sleep 1
fi

# Double-check — no one should be listening anywhere in the range. If the
# kill didn't take (rare, but happens with weird process states), surface
# the problem loud instead of silently binding a new process next to an
# old one that keeps serving stale bundles.
for PORT in 7700 7701 7702 7703 7704 7705 7706 7707 7708 7709 7710; do
  if lsof -ti :"$PORT" >/dev/null 2>&1; then
    echo "[reload-dashboard] port $PORT still occupied after kill -9 — investigate with: lsof -i :$PORT" >&2
    exit 1
  fi
done

# Start fresh. nohup detaches so exiting the terminal doesn't kill it.
LOG_DIR="$HOME/.dearuser"
mkdir -p "$LOG_DIR"
nohup node "$DIST_ENTRY" >> "$LOG_DIR/dashboard.log" 2>&1 &
NEW_PID=$!

# Verify it actually bound. Wait up to 3 seconds for a port in the range.
for _ in 1 2 3 4 5 6; do
  for PORT in 7700 7701 7702 7703 7704 7705 7706 7707 7708 7709 7710; do
    if lsof -ti :"$PORT" >/dev/null 2>&1; then
      echo "[reload-dashboard] running (pid $NEW_PID) on port $PORT — logs at $LOG_DIR/dashboard.log"
      exit 0
    fi
  done
  sleep 0.5
done

echo "[reload-dashboard] started pid $NEW_PID but could not confirm port bind within 3s — check $LOG_DIR/dashboard.log" >&2
exit 0
