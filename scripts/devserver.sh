#!/usr/bin/env bash
# Start/stop the Alongside backend for manual testing, tracked by PID file.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="${ALONGSIDE_PIDFILE:-/tmp/alongside-server.pid}"
LOGFILE="${ALONGSIDE_LOGFILE:-/tmp/alongside-server.log}"

case "${1:-}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE"))"; exit 0
    fi
    cd "$ROOT/apps/server"
    # setsid so stop kills tsx and the node child it spawns, not just the parent.
    setsid nohup npx tsx src/index.ts > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 30); do
      sleep 1
      if curl -s -m 2 "http://localhost:${PORT:-4000}/api/health" > /dev/null; then
        echo "started (pid $(cat "$PIDFILE"))"; exit 0
      fi
    done
    echo "failed to start; log:"; tail -20 "$LOGFILE"; exit 1
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill -- "-$(cat "$PIDFILE")" 2>/dev/null || kill "$(cat "$PIDFILE")" 2>/dev/null
      rm -f "$PIDFILE"
      sleep 1
      echo stopped
    else
      echo "not running"
    fi
    ;;
  log) tail -"${2:-40}" "$LOGFILE" ;;
  *) echo "usage: devserver.sh {start|stop|log [lines]}"; exit 2 ;;
esac
