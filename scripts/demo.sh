#!/usr/bin/env bash
#
# Start everything needed for a demo on one machine, and print what you need.
#
#   ./scripts/demo.sh            start the backend and the web app
#   ./scripts/demo.sh --reseed   wipe the household first and start clean
#
# Leave this running. Ctrl-C stops both servers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--reseed" ]; then
  npm run reset -w @alongside/server >/dev/null
  npm run seed -w @alongside/server >/dev/null
  echo "Household reset and reseeded."
fi

if [ ! -f apps/server/data/alongside.db ]; then
  echo "No household yet — seeding one."
  npm run seed -w @alongside/server >/dev/null
fi

# Read the live values rather than reprinting what the seed said once.
PAIRING=$(cd apps/server && npx --yes tsx -e "
import { openDb } from './src/db.ts';
const row = openDb().prepare('SELECT pairing_code FROM households LIMIT 1').get();
console.log(row ? row.pairing_code : 'none');
" 2>/dev/null | tail -1)

# Best-effort LAN address, for driving the dashboard from a phone.
LAN=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || echo '') | awk '{print $1}')

cat <<INFO

  Alongside is starting.

  ANNA — the caregiver, in your browser
    Dashboard        http://localhost:5173/
    Routine builder  http://localhost:5173/builder
    Household        http://localhost:5173/settings     (demo clock lives here)
$([ -n "$LAN" ] && echo "    From your phone  http://$LAN:5173/")

  MARY — the older adult
    Voice client     http://localhost:5173/voice        (Chrome or Edge, allow the mic)
    Television       the Fire TV app, or http://localhost:5173/tv to mirror it

  PAIRING CODE       $PAIRING
    Enter this in the voice client and in the Fire TV app.

  SERVER ADDRESS for the Fire TV app
    Android TV emulator on this machine   http://10.0.2.2:4000
$([ -n "$LAN" ] && echo "    A Fire TV Stick on your network       http://$LAN:4000")
    Amazon's cloud Fire TV                run: npx ngrok http 4000

  Ctrl-C stops everything.

INFO

npm run dev
