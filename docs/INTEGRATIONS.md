# Integrations: what is real, what is simulated, what is missing

This document exists so nobody has to guess. Where something is simulated, it says so, it
says why, and it says exactly what would be needed to make it real.

---

## 1. Fire TV — real

**Status: a real Fire OS application, built from this repository.**

- React Native 0.76.5 → Android. `apps/firetv/`.
- `AndroidManifest.xml` declares `android.intent.category.LEANBACK_LAUNCHER`,
  `android.software.leanback` (`required="false"`) and `android.hardware.touchscreen`
  (`required="false"`), a home-screen `android:banner`, and landscape orientation.
- `minSdkVersion 24`, `targetSdkVersion 34`, `compileSdk 35`. Fire TV Stick 4K and 4K Max
  run Fire OS 7/8 (API 28+), comfortably inside that range.
- Remote control: a small Kotlin bridge (`RemoteKeyModule.kt`) forwards D-pad, select,
  media and menu keys to JavaScript, where focus is managed explicitly. BACK is deliberately
  **not** intercepted, so it stays with React Native's `BackHandler` and behaves the way
  Fire TV users expect.
- Nothing in the app needs touch, a mouse or a keyboard, except the one-time setup screen,
  which uses the television's own on-screen keyboard (and hands key handling back to Android
  while it is open).

**Verified:** the release APK builds from a clean checkout in this environment, with the JS
bundle embedded (`assembleRelease`). **Not verified:** running on physical Fire TV hardware
or in the Fire TV emulator — the build environment used here has no `/dev/kvm`, so no Android
emulator can start in it, and no Fire TV device was available. The remaining step is
`adb install` and a visual pass; see [FIRETV.md](FIRETV.md), which lists exactly what to
check.

**Vega OS** was considered and not used: the Vega SDK requires a developer account with
access granted by Amazon, which we do not have. The React Native code here is the closest
sensible starting point if that access arrives.

---

## 2. Alexa+ — simulation, plus a real MCP server

The hackathon offers two routes. We took the permitted simulation route for the user-facing
experience, and additionally implemented the MCP server properly, because it is the part
that would actually connect to Alexa+ if we had Preview access.

### 2a. The Alexa+ experience simulation — real voice, clearly labelled

`apps/web/src/pages/Voice.tsx`, served at `/voice`.

- Real microphone input through the browser's `SpeechRecognition` (Chrome and Edge), with a
  typed fallback everywhere else that goes through exactly the same backend.
- Real spoken output through `speechSynthesis`, at the speech rate the caregiver set.
- **Push-to-talk.** There is no wake word and the page says so. Nothing is listening until
  the button is held.
- The microphone is closed while the assistant is speaking, so it cannot transcribe its own
  voice as the person's reply. Speaking can be interrupted with a Stop button.
- It receives household and routine context, shows the transcript, shows listening and
  speaking state, and updates the same routine occurrence the Fire TV app is showing.
- A banner on every screen reads: *"Alexa+ experience simulation. This is Alongside's own
  web voice client… It is not Amazon Alexa and does not run on an Echo device."*

**This is not Alexa.** It does not use Alexa's speech stack, it is not invoked by saying
"Alexa", and installing it changes nothing about any Echo device.

### 2b. The MCP server — real code, not connected to Alexa+

`apps/server/src/mcp.ts`, served at `POST|GET|DELETE /mcp`.

Implemented directly against the specification rather than through a framework, so the wire
behaviour is explicit and testable:

| Requirement | Implementation |
| --- | --- |
| Protocol revision | Advertises and negotiates `2025-11-25`; also accepts `2025-06-18` and `2025-03-26` |
| Transport | Streamable HTTP: one endpoint, `POST` for messages, `GET` for an SSE stream, `DELETE` to terminate |
| `Origin` validation | A present, non-allow-listed, non-localhost `Origin` gets `403` |
| Session management | A cryptographically random `MCP-Session-Id` on the `InitializeResult`; required afterwards (`400` without it, `404` once terminated) |
| `MCP-Protocol-Version` header | Honoured; an unsupported value is `400`; absent is treated as `2025-03-26` as the spec requires |
| Notifications | `202 Accepted` with no body |
| SSE stream | Primed with an event id and a `retry` field so a client can resume with `Last-Event-ID` |
| Auth | A household bearer token; no token, no session |

Tools exposed: `alongside_get_today`, `alongside_get_current_activity`, `alongside_say`,
`alongside_start_activity`, `alongside_next_step`, `alongside_postpone`,
`alongside_complete_activity`, `alongside_request_help`, `alongside_explain_step`. Every one
lands on the same validated commands the television uses, so an MCP client cannot reach
state the product does not allow. `alongside_explain_step` returns provenance so a client
can tell an approved instruction from "we do not know".

Fourteen tests in `apps/server/test/mcp.test.ts` cover the transport rules and the tools.

**What is missing, precisely.** The server is not registered with Alexa+ and has never
served a request from one. To make that real we would need:

1. **Alexa+ Preview access** for the developer account, and admission to whatever onboarding
   program exposes third-party MCP servers to Alexa+.
2. **A publicly reachable HTTPS endpoint** with a certificate — Alexa+ cannot reach
   `http://192.168.x.x:4000`. A tunnel or a small deployment would do.
3. **The authentication scheme Alexa+ expects** for third-party MCP servers (account
   linking, OAuth, or a bearer token it is configured with). Today `/mcp` takes the
   household's own bearer token, which is fine for a local client and not what a consumer
   integration would use.
4. **Whatever registration or manifest step** Alexa+ requires to associate the server with a
   customer's account.

**Two things we are explicitly not claiming**, because they are common and wrong:

- An ordinary conversation with Alexa does **not** reach this application. Nothing about
  running an MCP server makes "Alexa, what's for breakfast?" route here.
- An MCP server by itself does **not** let anything speak proactively through an Echo, and
  does **not** let it drive a Fire TV app. Proactive speech and app control are separate
  capabilities with their own requirements.

---

## 3. AI providers — real, three of them

`apps/server/src/ai/`. Selected with `ALONGSIDE_AI_PROVIDER`.

| Provider | Credentials | Status |
| --- | --- | --- |
| `local` (default) | none | **Exercised constantly.** The deterministic rule-based provider every test and the recorded demo run on. |
| `anthropic` | `ANTHROPIC_API_KEY` | **Written, not run against the live API in this build** — no key was available in the build environment. It uses the documented Messages API shape with a single tool and `tool_choice`, and parses the result through the same zod schema as the others. |
| `bedrock` | standard AWS chain + model access | **Written, not run against a live account in this build.** Uses `ConverseCommand` with `toolConfig`/`toolChoice`. |

All three return identical, schema-validated structures, so switching providers cannot
change what the database can contain. A hosted provider that fails falls back to `local` and
records the reason, which the dashboard displays.

> **On the AWS Builder mini challenge:** a Bedrock adapter is implemented and selectable,
> but it has **not** been run against a live Bedrock account here, so we are not claiming a
> verified AWS integration. Running `ALONGSIDE_AI_PROVIDER=bedrock` with credentials and
> model access is the only step left, and the dashboard will show which provider actually
> served each draft.

---

## 4. Ring — simulated, labelled, and minimal

Optional, built only after the core worked. `POST /api/ring/simulate` injects one event
carrying only the fields a doorbell press actually carries: kind (`ding`/`motion`), device
name, timestamp, source (`simulator`) and an optional still image. The Fire TV app shows
*"Someone is at the Front Door. (Simulated doorbell event.)"* and the assistant can be asked
what arrived; it answers from the event and nothing else.

**No Ring account, SDK or cloud connection exists in this build.** We did not evaluate the
official Ring simulator, so no claim is made about matching its payloads. Deliberately
absent: identity recognition, indoor activity, raw video, two-way audio, and any form of
unlocking. None of those are things this event can support, and inventing them would be the
exact failure mode this document exists to prevent.

---

## 5. Bee — not used

No Bee device or Apple Watch running Bee software was available, and the Bee track requires
real recorded data. Rather than mention Bee without using it, we left the track alone.

---

## 6. Notifications — dashboard only, by design

A help request writes a record that appears on the caregiver's dashboard immediately, over
the same event stream as everything else. Nothing is emailed, texted or pushed, and no
screen says "delivered". The assistant's own wording is: *"I've put a help request on Anna's
dashboard… nothing has been sent as a message or a call."*

Adding real delivery is a small change (a provider in the help-request command) and a large
responsibility — it would need a configured provider, a tested failure path, and a clear
distinction on screen between "recorded" and "delivered". It is listed in
[LIMITATIONS.md](LIMITATIONS.md) rather than half-built.

---

## 7. Open Source mini challenge — read the rules before claiming it

The challenge asks for *"a new, additional open-source project … or a contribution (a
branch, a fork, or a pull request) to a public repository during the hackathon window,
**alongside** your primary-track submission"*.

This repository carries an Apache 2.0 licence and can be made public, but on a plain reading
**that alone does not qualify**: the challenge wants something additional to the main
submission. A natural candidate from this work would be extracting the dependency-free
Streamable HTTP MCP server (`apps/server/src/mcp.ts`) into its own small package, or
contributing the `.js`→`.ts` Metro resolution recipe for shared workspace sources upstream.
Neither has been done, so no claim is made.
