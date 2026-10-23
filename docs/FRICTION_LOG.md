# Friction log

Only issues actually hit while building Alongside, with what was expected, what happened,
and what would have helped. Nothing here is hypothetical.

Severity: **High** — blocked progress until worked around · **Medium** — cost a build cycle
or a wrong turn · **Low** — a few minutes.

---

## 1. The Fire TV manifest documentation page is a 404

**Severity: Medium**

**Task.** Find the authoritative list of `AndroidManifest.xml` requirements for a Fire TV
app before writing one.

**Steps.** Fetched `https://developer.amazon.com/docs/fire-tv/manifest-fire-tv.html`, the
page that search results and older write-ups point to.

**Expected.** A current page listing the required `uses-feature` entries, the banner,
`LEANBACK_LAUNCHER`, and min/target SDK guidance per Fire OS version.

**Actual.** `HTTP 404 Not Found`. The requirements had to be assembled from Google's Android
TV documentation plus an Amazon blog post from 2021 about touch-enabling web apps.

**Workaround.** Followed Google's Android TV manifest conventions and verified the built APK
with `aapt2 dump badging`, which reports `leanback-launchable-activity` and the
not-required features directly.

**Suggestion.** Restore or redirect that URL, and keep one "Fire TV manifest checklist" page
current: required and not-required features, banner dimensions, launcher categories, and a
Fire OS → API level table. Verification with `aapt2 dump badging` deserves a mention on it —
it turns a guess into a check.

---

## 2. React Native's TV support lives in a fork, and nothing says so

**Severity: High**

**Task.** Implement D-pad navigation for a Fire TV app written in React Native.

**Steps.** Looked for `TVEventHandler`, `hasTVPreferredFocus` and `TVFocusGuideView` in
`react-native@0.76.5`.

**Expected.** Some TV input affordance in core, given that "React Native" is listed first
among the frameworks for this track.

**Actual.** None of them exist in upstream React Native; they are in the separate
`react-native-tvos` fork. Nothing in the Fire TV track materials mentions this, so the
obvious reading — "use React Native" — leads to an app with no way to respond to a remote.

**Workaround.** Wrote a small Kotlin bridge (`RemoteKeyModule.kt`, ~40 lines) that forwards
D-pad, select, media and menu keys from `dispatchKeyEvent` to JavaScript, and manage focus
explicitly in JS. This turned out better than we expected for a product with a handful of
large choices per screen — the highlight is always exactly where the screen says it is — but
it was not a choice we made deliberately at the start.

**Suggestion.** One short page: "React Native on Fire TV — use `react-native-tvos`, or write
this much yourself." Forty lines of sample Kotlin for the key bridge would be enough for
teams that want to stay on upstream.

---

## 3. No way to run a Fire TV app in a cloud build environment

**Severity: High**

**Task.** Launch the built APK to check the layout and the remote navigation.

**Steps.** Installed the Android SDK and an Android TV system image in a Linux build
container; attempted to start an emulator.

**Expected.** Slow, but possible.

**Actual.** Not impossible, but undocumented and easy to give up on. The host CPU exposed no
virtualization extensions at all (no `vmx`/`svm` in `/proc/cpuinfo`), so `/dev/kvm` does not
exist and every "just enable KVM" answer is a dead end.

**Workaround.** Two dead ends and one that worked.

- An **ARM64** Android TV image under software emulation is refused outright:
  *"Avd's CPU Architecture 'arm64' is not supported by the QEMU2 emulator on x86_64 host."*
  Cross-architecture emulation is simply gone.
- An **x86_64** Android TV image with `-accel off` **does** boot under QEMU's software
  emulation — in about ten minutes, which is tedious but entirely workable. That is the
  escape hatch, and it is not documented anywhere we could find.

With that running we drove the whole app through `adb shell input keyevent`, which delivers
genuine D-pad and select events, and it found five defects that the build, the tests and the
browser mirror had all missed.

**Suggestion.** Two things would each have saved hours. First, say in the emulator docs that
an architecture-matched image with `-accel off` is a supported fallback when KVM is
unavailable — the current failure mode is an arch error that reads like "you cannot do this
at all". Second, and more valuable for this track: a browser-hosted Fire TV simulator. We
later found Amazon's **Live Device Interaction** virtual device farm, which is exactly that
and is excellent — it is just not mentioned anywhere in the Fire TV getting-started path a
new developer follows.

**Suggestion.** This is the highest-value gap for the Fire TV track. A browser-hosted Fire TV
simulator (even screenshot-only), or a documented way to get a remote device session for a
hackathon, would let teams on cloud machines actually see their app. A lot of hackathon work
now happens on hosted environments, and this track currently assumes a local workstation.

---

## 4. Maven Central returns HTTP 429 during a cold React Native build

**Severity: Medium**

**Task.** Build the release APK.

**Steps.** `./gradlew assembleRelease` on a clean Gradle cache.

**Expected.** A long download, then a build.

**Actual.** Failed twice with `Could not resolve org.jetbrains.kotlin:kotlin-script-runtime`
and similar — each caused by `Received status code 429 from server: Too Many Requests` from
`repo.maven.apache.org`. A cold React Native build pulls enough artifacts to hit Maven
Central's per-IP rate limit, which a shared or CI egress address reaches easily. The failure
reads as a dependency problem, not a rate-limiting problem, and it fails the build part-way
through rather than backing off.

**Workaround.** An init script that puts the Google-hosted Maven Central mirror
(`https://maven-central.storage-download.googleapis.com/maven2`) in front, applied to every
project **including the React Native Gradle plugin's own included build** — which is where
ours stalled, and which a project-level `repositories` block does not reach. Shipped as
`apps/firetv/android/mirrors.init.gradle`.

**Suggestion.** React Native's Android template could include a mirror by default, or the
docs could carry a "429 from Maven Central" entry with this init script. Gradle could also
say "this was a 429" rather than "could not resolve".

---

## 5. Metro cannot resolve TypeScript sources from a sibling workspace package

**Severity: Medium**

**Task.** Have the Fire TV app import the same domain types and timezone helpers as the
backend, from `packages/shared`.

**Steps.** Added `watchFolders` and `extraNodeModules` pointing at the shared package, then
built.

**Expected.** Metro compiles the shared `.ts` files like any other source.

**Actual.** Three consecutive failures, each needing a full build cycle to find:

1. `Unable to resolve module zod from packages/shared/src/schemas.ts` — the shared package's
   index re-exports a schemas module, and Metro has no tree-shaking, so a type-only import
   pulled a validation library into the television bundle.
2. `Unable to resolve module ./domain.js` — TypeScript's ESM output style writes `./x.js`
   specifiers next to `./x.ts` sources, and Metro resolves the literal path.
3. `Unable to resolve module @babel/runtime/helpers/interopRequireDefault from
   packages/shared/src/time.ts` — Babel injects runtime helpers into every transformed file,
   and Metro looks for them relative to the file, not the app.

**Workaround.** About fifteen lines in `metro.config.js`: a `resolveRequest` that rewrites
`.js` to `.ts` for files under the shared root, explicit `nodeModulesPaths`, and a
dependency-free entry point (`packages/shared/src/tv.ts`) for the TV app so no validation
library reaches the bundle.

**Suggestion.** A documented "sharing a TypeScript package across a monorepo" recipe in the
React Native docs would cover a very common setup. Failing that, the resolver error could
name the resolution rule that failed, not just the module — "no `nodeModulesPaths` entry
covers this file" would have been an instant fix instead of a build cycle.

---

## 6. React Native has no EventSource and no streaming fetch

**Severity: Medium**

**Task.** Have the Fire TV app receive the same live updates as the browser clients, which
use Server-Sent Events.

**Expected.** Either `EventSource`, or a `fetch` whose body can be read as a stream.

**Actual.** Neither. React Native's `fetch` is XHR-backed and resolves the whole body, and
there is no `EventSource`. Adding a polyfill was possible but meant another dependency in
the path the product most depends on.

**Workaround.** Added a WebSocket endpoint to the backend carrying the identical event
payloads, with polling as a fallback and a visible "Not connected" state. This is arguably
the better design for a television anyway — but it exists because of a platform gap, not a
decision.

**Suggestion.** Worth a line in the React Native networking docs: "there is no EventSource;
use WebSocket". It is the kind of thing teams discover at the point where it costs the most.

---

## 7. `aapt2 dump badging` is the fastest TV-app check and is not mentioned anywhere

**Severity: Low** (a positive finding, logged because it would help others)

**Task.** Confirm the APK really is a Fire TV app before trying to install it.

**Actual.** `aapt2 dump badging app-release.apk` prints `leanback-launchable-activity`,
`uses-feature-not-required: android.hardware.touchscreen`,
`uses-feature-not-required: android.software.leanback` and the banner resource — exactly the
properties that determine whether the app shows up on the Fire TV home screen.

**Suggestion.** Put this one command in the Fire TV getting-started docs. It converts the
most common category of Fire TV submission mistake into a two-second check.

---

## 8. `multer`'s `fileFilter` callback cannot be called one way

**Severity: Low**

**Task.** Reject non-media uploads.

**Actual.** The TypeScript overloads for `multer`'s `fileFilter` callback do not allow
`cb(error, false)`; the error path and the accept path must be separate calls with different
arities. Compiles once you split them, but the error message points at the whole call rather
than the overload.

**Workaround.** Two calls instead of one.

**Suggestion.** Worth a line in `@types/multer`'s documentation.

---

## 9. Playwright's `networkidle` never settles on a page holding an SSE connection

**Severity: Low**

**Task.** Screenshot the running dashboard to check the layout.

**Actual.** `page.goto(url, { waitUntil: 'networkidle' })` timed out after 30 seconds on
every page, because the app holds an `EventSource` open — which is exactly what it is
supposed to do.

**Workaround.** `waitUntil: 'domcontentloaded'` plus an explicit wait.

**Suggestion.** The `networkidle` documentation already discourages it; a specific mention of
SSE and WebSocket alongside the existing warning would make the reason obvious.
