# Running the whole thing on one laptop

No Fire TV Stick, no Android phone. One machine, three windows, both people.

| Window | Who | What |
| --- | --- | --- |
| Browser tab 1 | **Anna** | the caregiver dashboard and routine builder |
| Browser tab 2 | **Mary** | the voice client — this is where she talks |
| Emulator window | **Mary** | the television, running the real APK |

**The television has no microphone.** Mary speaks in the voice client; the television
reacts. That separation is the product: one shared backend, two surfaces that cannot
disagree. It is also what the demo is meant to show.

---

## 1. Start Alongside

```bash
./scripts/demo.sh            # add --reseed to start from a clean household
```

It prints the pairing code, every URL, and the server address to type into the
television. Leave it running.

## 2. Put a television on your laptop

### Install Android Studio

[developer.android.com/studio](https://developer.android.com/studio) — free, and it brings
the SDK, the emulator and `adb` with it.

### Create a TV device

**More Actions → Virtual Device Manager → Create Virtual Device**

1. Category **TV** → **Television (1080p)**
2. System image: **API 34** or newer
   - Apple Silicon Mac → an **arm64-v8a** image
   - Intel/AMD Mac, Windows, Linux → an **x86_64** image
3. Finish, then press ▶ to start it.

A 1920×1080 television appears on your desktop. First boot takes a few minutes.

> **"HAXM/WHPX/KVM not installed"** means virtualization is off. Turn on **Intel VT-x** or
> **AMD-V** in your BIOS (Windows: also enable *Windows Hypervisor Platform* in "Turn
> Windows features on or off"). On Linux your user needs to be in the `kvm` group.
> If you cannot enable it at all, skip to [Plan B](#plan-b-if-the-emulator-will-not-start).

### Install the app

Easiest: **drag `app-release.apk` onto the emulator window.** It installs in a few seconds.

Or from a terminal:

```bash
adb install -r apps/firetv/android/app/build/outputs/apk/release/app-release.apk
```

Build it yourself with `npm run build:release -w @alongside/firetv` if you do not have the
file. Launch it from the emulator's app row, or:

```bash
adb shell am start -n com.alongside.firetv/.MainActivity
```

### Drive it

| Key | Does |
| --- | --- |
| Arrow keys | move the highlight |
| Enter | choose |
| Esc | Back |

The highlight is the amber button with the white ring. Nothing needs a mouse.

### Pair it

On the setup screen:

1. **Server address** → `http://10.0.2.2:4000`
   `10.0.2.2` is the emulator's name for *this laptop*. `localhost` would mean the
   television itself, which is why it does not work.
2. **Pairing code** → the six characters `demo.sh` printed.
3. **Connect.**

While the on-screen keyboard is up it takes over the arrow keys — press **Esc** (Back) to
close it, then carry on.

---

## 3. Lay out the screen

- Browser **left half**: `http://localhost:5173/` — Anna.
- Browser **second tab**: `http://localhost:5173/voice` — Mary. Use **Chrome or Edge** and
  allow the microphone. Pair it with the same code.
- Emulator window **right half**: the television.

You can now see all three at once, which is exactly the shot your demo needs.

---

## 4. Play both people

**As Anna**, in the routine builder:

> Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the
> fridge. Use this photo to show her which one. Ask if she wants preparation help. If she
> says later, ask again in fifteen minutes.

Attach a picture from `demo-assets/`. Alongside answers with a question rather than a
guess — *"What preparation instructions should I give Mary?"* — so give it the steps:

> Take the yellow container out of the fridge from the middle shelf. Tip the oatmeal into a
> bowl and add milk up to the line. Heat it in the microwave for two minutes, then give it a
> stir. If the yellow container isn't there, there are oatmeal packets in the pantry on the
> second shelf.

Then **"Make it eight thirty instead."**, and press **Publish**.

**Still as Anna**, in Household → Demo clock: set **07:55**, then press **+5 min**.

Watch the television. Breakfast appears with Anna's photo.

**Now be Mary.** In the voice client, hold the button and say — or just type:

| Say this | Watch the television |
| --- | --- |
| "Yes. What am I having?" | starts, shows the photo and step 1 |
| "Help me with the next step." | advances to step 2 |
| "Give me fifteen minutes." | goes to Postponed — and so does Anna's dashboard |
| "The container isn't there." | Anna's approved answer about the pantry |
| "I need help." | a help request appears on Anna's dashboard instantly |
| "I already ate." | all three screens read Completed (self-reported) |

You can also drive the television directly with the arrow keys — **Start**, **Done, what is
next**, **Something is different**, **I need help**. Either way the other two screens follow,
because there is only ever one source of truth.

---

## Plan B, if the emulator will not start

Two routes that need no virtualization:

- **Amazon's Live Device Interaction** — a real Fire TV in your browser. Upload the APK,
  drive it with a virtual remote, record video. It needs the backend reachable from the
  internet, so run `npx ngrok http 4000` and give the app the `https://…` URL instead of
  `10.0.2.2`. Details in [FIRETV.md](FIRETV.md).
- **The browser mirror** at `http://localhost:5173/tv` shows the same television state from
  the same backend. Fine for working on the product — but it is **not** the APK, it says so
  on screen, and it must not be the Fire TV footage in your demo video.
