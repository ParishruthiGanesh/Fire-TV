#!/usr/bin/env bash
# Start/stop the Vite dev server for manual testing, tracked by PID file.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="${ALONGSIDE_WEB_PIDFILE:-/tmp/alongside-web.pid}"
LOGFILE="${ALONGSIDE_WEB_LOGFILE:-/tmp/alongside-web.log}"

case "${1:-}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE"))"; exit 0
    fi
    cd "$ROOT/apps/web"
    setsid nohup npx vite --port 5173 --host > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 30); do
      sleep 1
      if curl -s -m 2 "http://localhost:5173/" > /dev/null; then echo "started"; exit 0; fi
    done
    echo "failed to start"; tail -20 "$LOGFILE"; exit 1
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill -- "-$(cat "$PIDFILE")" 2>/dev/null || kill "$(cat "$PIDFILE")" 2>/dev/null
      rm -f "$PIDFILE"; sleep 1; echo stopped
    else echo "not running"; fi
    ;;
  log) tail -"${2:-40}" "$LOGFILE" ;;
  *) echo "usage: devweb.sh {start|stop|log [lines]}"; exit 2 ;;
esac
