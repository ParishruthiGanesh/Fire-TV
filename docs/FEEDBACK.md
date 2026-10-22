# Product feedback

Feedback on every tool, API and SDK used to build Alongside. Where something was written
against documentation but not run against a live service, that is stated rather than
glossed over.

---

## Fire TV / Fire OS (primary track)

**What we used it for.** The whole older-adult experience: a React Native app for Fire OS
with leanback launcher, D-pad navigation and a home-screen banner.

**What worked well.** Fire OS being Android means the entire Android toolchain applies with
no translation: `assembleRelease` produced an installable APK, `aapt2 dump badging`
confirmed the leanback launcher and banner, and `adb install` is the same as anywhere else.
Not needing a special SDK to target Fire TV is a real advantage, and it means a team can
develop against an ordinary Android TV emulator and ship to Fire TV unchanged. Allowing any
framework for this track is the right call.

**What needs work.**

1. **Manifest documentation.** The page we expected to be canonical —
   `developer.amazon.com/docs/fire-tv/manifest-fire-tv.html` — returns **404**. We ended up
   assembling the requirements from Google's Android TV docs plus an Amazon blog post from
   2021. A single current "Fire TV manifest checklist" page (leanback launcher, banner sizes,
   `required="false"` features, min/target SDK per Fire OS version) would remove a whole
   category of guessing.
2. **React Native on TV is a fork, and the docs do not say so loudly.** Upstream
   `react-native` has no `TVEventHandler`, no `hasTVPreferredFocus`, and no
   `TVFocusGuideView`; those live in `react-native-tvos`. We discovered this by reading
   source, not docs. A short "building for Fire TV with React Native" page that states the
   fork situation up front, and says what you have to write yourself if you stay on upstream,
   would save every team on this track an hour.
3. **No way to try it without hardware acceleration.** The Android TV emulator needs KVM. In
   a cloud build container — which is where a lot of hackathon work now happens — there is
   simply no way to launch the app at all. A browser-based Fire TV simulator, or a
   documented remote-device option, would be the single highest-value addition for this
   track.
4. **Fire OS version → API level mapping** is scattered. One table, kept current, would do.

**Onboarding.** Good, precisely because there is so little of it: if you know Android, you
know Fire TV. The friction was finding out which of the Android TV conventions Fire TV
actually cares about.

**Would we build with it again?** Yes. A television is the right surface for this product —
it is already in the room, already on, and already operated with a remote the person knows.

---

## Alexa+ (simulation route) and MCP

**What we used it for.** The conversational half: a browser voice client labelled as an
Alexa+ experience simulation, plus a real self-hosted Streamable HTTP MCP server at `/mcp`
implementing protocol revision `2025-11-25`.

**What worked well.** The MCP specification is unusually good to implement against: the
transport section is precise about status codes, headers and session lifecycle, so we
implemented it directly rather than through a framework and had tests passing the same day.
Being able to point at "this returns 400 without a session id, 404 once terminated" and show
a test for each is exactly what a spec should make possible. Offering a simulation route for
teams without Preview access is also the right decision — it let us build the product rather
than wait for access.

**What needs work.**

1. **There is no way to tell whether an MCP server is correct for Alexa+ specifically.** We
   can conform to the spec and test the transport, but we cannot tell whether Alexa+ expects
   a particular auth scheme, a particular tool-naming convention, or a registration step. A
   **conformance checker or a sandbox endpoint** — even one that just performs an initialize
   handshake and a `tools/list` against a URL and reports what it saw — would be the single
   most useful thing you could ship for this track.
2. **The boundary of what MCP gives you is not stated anywhere prominent.** Two assumptions
   are easy to make and both are wrong: that an ordinary Alexa conversation will reach your
   server, and that an MCP server lets you speak proactively through an Echo or drive a Fire
   TV app. We wrote both of these down as explicit non-claims in our own docs. A "what MCP
   does and does not give you" section would prevent a lot of disappointed demos.
3. **Auth for third-party MCP servers is undocumented** as far as we could find. Our
   endpoint takes the household's own bearer token, which is right for a local client and
   obviously not what a consumer integration would use.
4. **Preview access gating.** Understandable, but it does mean the most interesting part of
   this track is unavailable to most entrants, and a simulation can only demonstrate so much.

**Onboarding.** The MCP spec itself: excellent. The Alexa+ side: we never got past the gate,
so there is nothing to report.

**Would we build with it again?** Yes for MCP, which we would use for the structured tool
surface regardless of Alexa. Alexa+ specifically, we cannot judge without access.

---

## Ring (optional, simulated)

**What we used it for.** One doorbell event surfaced on the television, built only after the
core worked.

**What worked well.** Nothing to report honestly — we did not use a Ring SDK or the official
simulator.

**What needs work.** A clearly-linked, no-account-required event simulator with documented
payload shapes would have changed our decision. We wanted to model one real event type and
could not find, within the time we had, a definitive statement of what a `ding` event
actually contains for third-party developers. Rather than guess at a payload and present it
as a Ring integration, we built a labelled local simulator with only the fields we were
confident a doorbell press carries.

**Would we build with it again?** Yes, with device or simulator access. "Someone is at the
door" on a television that an older adult is already looking at is a genuinely good feature,
and it is the kind of thing that argues for itself.

---

## Bee

Not used. The track requires real recorded Bee data and we had neither a Bee device nor an
Apple Watch running Bee software. We would rather say that than mention Bee for the sake of
mentioning it.

---

## AWS

**What we used it for.** An Amazon Bedrock provider (`ConverseCommand` with
`toolConfig`/`toolChoice`) behind the same AI interface as the other providers, selectable
with one environment variable.

**What worked well.** The Converse API is the right abstraction: one request shape across
models, with tool use as a first-class concept, meant the Bedrock adapter is almost
line-for-line the Anthropic one. `@aws-sdk/client-bedrock-runtime` types are thorough.

**What needs work.** `inputSchema: { json: ... }` is typed as `DocumentType`, which a plain
`Record<string, unknown>` does not satisfy, so passing a JSON Schema object — the only thing
anyone passes — requires a cast. Worth a dedicated overload. Model ids also differ enough
between regions and inference profiles that a copy-pasted id frequently fails with an error
that does not say "try the inference-profile id".

**Honesty note.** This adapter has **not** been run against a live Bedrock account: no
credentials or model access were available in the build environment. We are therefore not
claiming a verified AWS integration, and the dashboard shows which provider actually served
each draft.

**Would we build with it again?** Yes — keeping model credentials server-side behind one
adapter is the right shape for a product like this, and Bedrock fits it.

---

## Anthropic API (Claude)

**What we used it for.** The hosted `anthropic` provider: turning caregiver conversation
into a structured draft, classifying what the older adult said, and choosing among approved
alternatives.

**What worked well.** A single tool plus `tool_choice: {type: 'tool'}` is a clean way to get
structured output, and the SDK's types made the tool-use block easy to narrow. The same JSON
Schema worked unchanged on Bedrock.

**What needs work.** `input_schema` is typed loosely enough that a schema mistake surfaces as
a runtime validation failure rather than a type error.

**Honesty note.** Also written against the documented API but **not** run against a live key
here. Every response passes through the same zod schema as the deterministic provider, so a
malformed or creative response is rejected rather than stored.

---

## React Native 0.76 and Metro

**What we used it for.** The Fire TV app, sharing TypeScript domain types with the backend.

**What worked well.** Prebuilt Android artifacts mean a cold build needs no NDK and finishes
in a few minutes on a modest machine. Hermes and the release bundling step are invisible, in
the good way: `assembleRelease` produced a self-contained APK first time.

**What needs work.**

1. **Sharing a TypeScript package across a monorepo is still a config exercise.** Two
   separate failures: Metro does not map the ESM-style `./x.js` specifiers that TypeScript
   emits onto the `.ts` sources it is compiling, and it does not know where the app's
   `node_modules` are when transforming files outside the project root, so Babel's injected
   runtime helpers fail to resolve. Both are fixable in about fifteen lines of
   `metro.config.js`, and both cost a build cycle to diagnose because the error names a
   module rather than the resolution rule that failed.
2. **No tree-shaking** means a barrel export is expensive: importing a type from a package
   whose index re-exports a schemas module pulled a validation library into the television
   bundle. We split a dependency-free entry point for the TV app.
3. **TV support in upstream React Native is effectively absent**, as above.

**Onboarding.** `@react-native-community/cli init` is fast and the template is sensible.

**Would we build with it again?** For a TV app sharing types with a TypeScript backend, yes.

---

## Android toolchain (Gradle, Android SDK, aapt2, adb)

**What worked well.** `aapt2 dump badging` is the fastest way to verify that a TV app really
is a TV app — it prints `leanback-launchable-activity` and the not-required features
directly, which turned "I think the manifest is right" into "the APK says so".

**What needs work.** A cold React Native build pulls enough from Maven Central to trigger
**HTTP 429 Too Many Requests** from a shared or CI IP, and the failure surfaces as an
unresolved dependency rather than as rate limiting. We ship an optional init script that
puts the Google-hosted mirror in front of Maven Central. Gradle could usefully say "this was
a 429, consider a mirror" instead of "could not resolve".

**Would we build with it again?** Yes.

---

## Web Speech API (`SpeechRecognition`, `speechSynthesis`)

**What we used it for.** The voice client's microphone input and spoken replies, and
dictation in the caregiver's routine builder.

**What worked well.** For a push-to-talk interface it is genuinely enough: interim results
make the listening state feel alive, and `speechSynthesis` rate control let us honour the
caregiver's speech-speed setting with one line.

**What needs work.** Chromium-only in practice, which forces every product using it to ship
a typed fallback. `onend` fires in several different circumstances with no way to tell them
apart, so "the user stopped talking" and "recognition gave up" look identical. And there is
no way to ask the browser to ignore audio the page is itself producing, so avoiding the
assistant transcribing its own voice means closing the microphone while speaking.

**Would we build with it again?** For a demo, yes. For a product an older adult depends on,
we would want a speech stack with a service-level agreement.

---

## better-sqlite3, Express, zod, ws

**What we used them for.** The backend: storage, HTTP, validation, and the WebSocket the TV
app connects over.

**What worked well.** `better-sqlite3`'s synchronous API makes transactional state machines
genuinely simple to read — the occurrence state machine is ordinary code with no await
noise. zod at the model boundary is the thing that makes "the AI never writes to the
database" a property rather than an intention. `ws` attached to an existing HTTP server in
about five lines.

**What needs work.** Express 4's `multer` `fileFilter` callback is typed so that the error
and success paths cannot share a call signature; it compiles only if you call it two
different ways. Minor, but it cost a few minutes.

**Would we build with them again?** Yes, all four.

---

## Vite, React, vitest, supertest, Playwright

**What we used them for.** The caregiver dashboard and voice client; the test suite; and
headless Chromium to screenshot and read the real UI rather than trusting that it rendered.

**What worked well.** Vite's dev proxy made bearer tokens, SSE and `<img>` media all
same-origin with three lines of config. `vitest` plus `supertest` let the nineteen-step demo
be written as one readable test against the real HTTP surface. Screenshotting the running app
found two layout bugs that no test would have caught.

**What needs work.** Playwright's `networkidle` never settles on a page holding an SSE
connection open — understandable, but it is a trap worth a line in the docs.

**Would we build with them again?** Yes.
