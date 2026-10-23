#!/usr/bin/env bash
# Render the narration to per-scene WAVs with piper, and report each duration.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$HERE/build/audio}"
PIPER="${PIPER_BIN:-/opt/piper/piper}"
VOICES="${PIPER_VOICES:-/opt/piper-voices}"
mkdir -p "$OUT"

VOICE=$(python3 -c "import json;print(json.load(open('$HERE/narration.json'))['voice'])")
python3 -c "
import json
for s in json.load(open('$HERE/narration.json'))['scenes']:
    print(s['id'] + '\t' + s['text'])
" | while IFS=$'\t' read -r id text; do
  printf '%s' "$text" | "$PIPER" --model "$VOICES/$VOICE.onnx" --output_file "$OUT/$id.wav" 2>/dev/null
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$id.wav")
  printf '%-14s %6.2fs  %s\n' "$id" "$dur" "$(printf '%.60s' "$text")"
done
