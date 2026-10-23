# Demo video pipeline

Builds a narrated demo from real recordings of the running product. Nothing here
re-enacts anything: the browser footage is a live session driving the real UI against
the real backend, and the television frames are screenshots of the actual APK.

```bash
./speak.sh              # narration -> build/audio/*.wav   (piper)
node record-web.mjs     # Anna's session -> build/raw/*.webm + marks
node record-voice.mjs   # Mary's session and the dashboard -> build/raw/*.webm + marks
python3 assemble.py     # -> build/alongside-demo-draft.mp4
```

| File | What it is |
| --- | --- |
| `narration.json` | the script: one entry per shot, with the footage it is cut from |
| `speak.sh` | renders the narration with [piper](https://github.com/rhasspy/piper) |
| `record-web.mjs` | drives the caregiver dashboard and routine builder, logging shot marks |
| `record-voice.mjs` | drives the voice client, then the dashboard reacting to it |
| `assemble.py` | trims each shot to its narration, letterboxes, captions, concatenates |
| `stills/` | Fire TV screenshots used for the television shots |

## Read this before you submit

**The voice is synthetic.** It is a neural text-to-speech placeholder so the cut can be
judged for timing. Record `build/narration-script.txt` in your own voice and swap the
track — a real voice is better than any synthesiser, and judges can tell.

**The television shots are stills, not motion.** They are genuine screenshots of this APK
running on an Android TV emulator, but the hackathon asks for the app *running* in the
video. The machine this was assembled on could not capture motion: with no hardware
acceleration there is no working video encoder on the device (`screenrecord` writes a
zero-byte file) and a screenshot takes about thirty seconds.

Capture real motion on whichever of these you have, and drop the clips into `stills/`'s
place in `assemble.py`:

- **Amazon's Live Device Interaction** — a cloud Fire TV in a browser, with a Screen tab
  that records video. See [../../docs/FIRETV.md](../../docs/FIRETV.md).
- **An Android TV emulator on a machine with virtualization**, captured with
  `adb shell screenrecord` or any screen recorder.
- **A Fire TV Stick**, captured with `adb shell screenrecord`.

## Changing the script

Edit `narration.json`, re-run `./speak.sh`, then `python3 assemble.py`. Shot lengths
follow the narration automatically, so you do not have to re-time anything by hand.

## Requirements

`ffmpeg`, Playwright with Chromium, and piper plus a voice model:

```bash
PIPER_BIN=/opt/piper/piper PIPER_VOICES=/opt/piper-voices ./speak.sh
```

Voices come from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices);
`narration.json` names the one to use.
