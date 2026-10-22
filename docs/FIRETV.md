# Running Alongside on Fire TV

The app in `apps/firetv/` is a React Native application that builds to an ordinary Android
APK for Fire OS. This page covers building it, getting it onto a device or an emulator, and
what to check once it is there.

---

## What you need

| | |
| --- | --- |
| JDK | 17 or newer (built and tested here with OpenJDK 21) |
| Android SDK | platform `android-35`, build-tools `35.0.0`, platform-tools |
| Node | 20 or newer |
| A target | a Fire TV device on the same network, **or** an Android TV emulator image |

Point Gradle at your SDK by creating `apps/firetv/android/local.properties`:

```properties
sdk.dir=/path/to/Android/sdk
```

(or export `ANDROID_HOME`). This file is machine-specific and is not committed.

---

## Build the APK

```bash
cd apps/firetv
npm install
npm run build:release
```

The artifact lands at:

```
apps/firetv/android/app/build/outputs/apk/release/app-release.apk
```

It is a **release** build, so the JavaScript bundle is embedded and the app runs without a
Metro development server. It is signed with React Native's standard debug keystore, which is
fine for sideloading and demos and is not suitable for store distribution.

Build only the ABIs you need to save time and space:

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a      # Fire TV hardware
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64         # emulator
```

### If Gradle fails with HTTP 429 from Maven Central

Maven Central rate-limits by IP and a cold React Native build pulls a lot of artifacts. This
repository ships an optional init script that puts the Google-hosted Maven Central mirror in
front of it, for every project including React Native's own included build:

```bash
cd android && ./gradlew assembleRelease -I mirrors.init.gradle
```

It changes no versions and no artifacts, only where they are fetched from.

---

## Install on a Fire TV device

1. On the device: **Settings → My Fire TV → Developer Options**, and turn on
   *ADB debugging* and *Apps from Unknown Sources*. (On newer Fire OS builds, Developer
   Options is hidden until you select **Settings → My Fire TV → About → Fire TV Stick**
   seven times.)
2. Find the device's IP under **Settings → My Fire TV → About → Network**.
3. From your computer:

```bash
adb connect <fire-tv-ip>:5555
adb install -r apps/firetv/android/app/build/outputs/apk/release/app-release.apk
```

4. Launch it from the Fire TV home row — it appears with its banner, because the manifest
   declares `LEANBACK_LAUNCHER`. Or start it directly:

```bash
adb shell am start -n com.alongside.firetv/.MainActivity
```

`npm run install:firetv` from `apps/firetv` runs the `adb install` step for you.

---

## Run on an emulator instead

A Fire TV device is not required. Any Android TV system image behaves the same way for this
app, because Fire OS is Android and the app uses no Amazon-specific APIs.

```bash
sdkmanager "system-images;android-34;android-tv;x86_64"
avdmanager create avd -n alongside-tv -k "system-images;android-34;android-tv;x86_64" \
  --device "tv_1080p"
emulator -avd alongside-tv
adb install -r apps/firetv/android/app/build/outputs/apk/release/app-release.apk
```

Amazon also publishes a **Fire TV / Vega simulator** through the Amazon Developer portal;
if you have access, it accepts the same APK through `adb install`.

Hardware acceleration is required: the emulator needs `/dev/kvm` on Linux, or HAXM/Hypervisor
Framework elsewhere. Arrow keys on your keyboard act as the D-pad and Enter acts as select,
so the whole app is operable without a remote.

---

## First run

The app asks for two things:

1. **Server address** — where the Alongside backend is on your network, for example
   `http://192.168.1.10:4000`. Use your computer's LAN IP, not `localhost`: `localhost` on a
   Fire TV means the Fire TV. Start the backend with `HOST=0.0.0.0` (the default) so it
   accepts connections from the device.
2. **Pairing code** — six characters, shown in the dashboard under **Household → Pairing**
   and printed by `npm run seed`.

Both are stored on the device, so this is a one-time step. The on-screen keyboard appears
when you select a field; while it is open the app hands key handling back to Android so the
keyboard behaves normally, and Back closes it.

The backend serves plain HTTP on a LAN, so the app's manifest sets
`android:usesCleartextTraffic="true"`. A production deployment would use HTTPS and drop that.

---

## Using the remote

| Button | What it does |
| --- | --- |
| D-pad left / right / up / down | move between the choices on screen |
| Select (centre) | choose the highlighted one |
| Back | one screen back; from the main screen, leave the app |
| Play/Pause | pause or resume the current activity |
| Menu | open "what is coming up" |

Focus is managed by the app rather than by Android's focus traversal, so the highlight is
always exactly where the screen says it is. Nothing requires touch, a mouse or a keyboard.

---

## What to check once it is installed

This is the pass we could not run ourselves (see the honesty note below), written out so it
is quick to do:

- [ ] The app appears on the Fire TV home row with the Alongside banner.
- [ ] Setup accepts the address and the code; the greeting screen appears with Mary's name.
- [ ] Text is readable from across the room; the focused button is unmistakable.
- [ ] D-pad moves the highlight; Select activates; Back goes one screen back and then exits.
- [ ] Advancing the demo clock on the dashboard makes the television show breakfast within
      a few seconds, with the caregiver's photo.
- [ ] "Done, what is next" advances the step on the television **and** on the dashboard.
- [ ] Speaking to the voice client moves the television to the same step.
- [ ] Pulling the network shows "Not connected"; restoring it recovers without a restart.
- [ ] Force-stopping and reopening the app returns to the same confirmed step.

---

## Honesty note on what was verified

The release APK **builds from a clean checkout** in the environment used to develop this,
with the JavaScript bundle embedded, the leanback launcher category, the home-screen banner,
and `touchscreen`/`leanback` both declared not-required — all confirmed by inspecting the
built APK with `aapt2 dump badging`.

The app has **not** been launched on physical Fire TV hardware or in an emulator from this
environment: the build machine has no `/dev/kvm`, so no Android emulator can start in it, and
no Fire TV device was attached. The backend contract the app depends on — pairing, snapshot,
WebSocket events, and every command the remote sends — **is** covered by automated tests
(`apps/server/test/tv-transport.test.ts` and `demo-flow.test.ts`), and the browser mirror at
`/tv` renders the same state from the same backend. What remains unverified is the on-device
visual and input pass listed above.

See [TESTING.md](TESTING.md) for the full list of what was and was not verified.
