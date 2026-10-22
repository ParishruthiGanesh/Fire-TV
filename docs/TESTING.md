# What was tested, and what was not

## Automated tests

```bash
npm test          # or: npx vitest run -w @alongside/server
```

**73 tests across 6 files**, all passing on the last run. They use an on-disk SQLite file per
test, so "close the app and reopen it" is a real reopen of a real database rather than a
mock.

| File | Covers |
| --- | --- |
| `publication.test.ts` | A draft produces no routine and no occurrence until it is published; publishing is refused without a time, a day or a step; a draft cannot be published twice; republishing bumps the version; missing instructions produce a clarifying question instead of an invention; a one-day change writes an override and leaves the recurring time alone. |
| `runtime.test.ts` | Postponing one occurrence leaves the routine and every other day untouched, and the new time survives a reload; duplicate commands with one idempotency key apply once; a repeated confirmation cannot skip a step; a repeated help message does not raise two requests; a confirmed step survives a reopen and resuming starts after it; showing or repeating a step never confirms it; a stale client gets `409`; declining one occurrence keeps the recurring routine; an occurrence is only ever "unconfirmed" after it was actually announced; a self-report invents no step confirmations; a state change reaches a connected SSE client; one household cannot read or change another's occurrences or media; an unknown token is rejected and a paired television cannot perform caregiver actions. |
| `understanding.test.ts` | Time parsing, including not mistaking "two minutes" for two o'clock; day patterns; follow-up intervals; scheduling talk and directions-to-the-assistant not becoming steps; instruction prose becoming ordered steps; alternatives only recorded when both halves were given; a one-day change not moving the recurring time; eighteen utterance classifications; a question kept alongside a "yes"; clarification instead of a guess when confidence is low; an approved alternative offered when one fits and admitted when none does; "yes" resolving against the last offer; wall-clock times holding across a daylight-saving change; occurrences materialising once per local date. |
| `mcp.test.ts` | Protocol negotiation and the `2025-11-25` revision; fallback for an unknown requested version; auth required to initialize; `202` for notifications; `400` without a session id and `404` for an unknown one; `400` for an unsupported `MCP-Protocol-Version`; `403` for a foreign `Origin`; the `GET` SSE stream primed with an event id and `retry`; `DELETE` terminating a session; `tools/list`; a tool call postponing without touching the routine; grounded answers with provenance; no duplicate help request on a retried call; the "nothing was sent" wording. |
| `tv-transport.test.ts` | The WebSocket path the Fire TV app uses: a snapshot on connect, a change from another surface arriving live, an invalid token refused with `4401`, and a due routine announced without the television asking. |
| `demo-flow.test.ts` | The full nineteen-step demo end to end through the public API, with a paired television and a paired voice client — described below. |

### The demo, as a test

`demo-flow.test.ts` walks the required flow exactly: Anna describes breakfast and attaches a
photo; the AI produces a draft and asks for the missing preparation steps; Anna supplies
them; she changes the time conversationally; she publishes; the routine appears for the
paired television; the demo clock reaches the time; the assistant announces it; Mary asks a
question and gets the approved answer; the television shows the same step; Mary postpones and
the television and dashboard both update; Mary resumes and confirms a step; the state
survives reopening the database; "the container isn't there" produces the caregiver-approved
alternative; Mary asks for help and a duplicate recognition result does not raise a second
request; Anna acknowledges it while the activity stays in progress; Mary reports completion;
all three surfaces agree on the final state and tomorrow is still scheduled.

Running the recorded demo and running the test exercise the same code paths.

## Verified by hand

- **The web app in a real browser.** The dashboard, routine builder, television mirror,
  household settings and voice client were loaded in headless Chromium, screenshotted and
  read; two layout bugs found that way were fixed (a flex container stealing the page's
  height, and an auto-margin collapsing the television frame to nothing).
- **The whole caregiver and runtime flow over HTTP**, against the running server with
  `curl`: draft creation, the follow-up question, step extraction, the conversational time
  change, publication, the demo clock, announcement, and each conversational turn.
- **The built APK**, inspected with `aapt2 dump badging`: package `com.alongside.firetv`,
  `minSdk 24`, `targetSdk 34`, a `leanback-launchable-activity` with a banner,
  `touchscreen` and `leanback` both declared not-required, and `assets/index.android.bundle`
  present, so it runs without a development server.
- **TypeScript across all four packages**, and the production build of the backend and web
  app.

## Not verified

- **The Fire TV app running on a device or an emulator.** The build environment has no
  `/dev/kvm`, so no Android emulator can start in it, and no Fire TV hardware was attached.
  The APK builds and its manifest is correct; the on-device visual and input pass is listed
  as a checklist in [FIRETV.md](FIRETV.md). The backend contract the app depends on is
  covered by `tv-transport.test.ts` and `demo-flow.test.ts`, and the `/tv` mirror renders
  the same state, but neither is the same as watching it on a television.
- **The hosted AI providers.** The Anthropic and Bedrock adapters are written against the
  documented APIs and parse into the same schemas, but no API key or Bedrock model access
  was available here, so neither has been run against a live endpoint. The deterministic
  provider is what every test and the demo exercise.
- **Alexa+ itself.** The MCP server's transport is tested, but it has never served a request
  from Alexa+; see [INTEGRATIONS.md](INTEGRATIONS.md) for the exact remaining dependencies.
- **Ring.** The doorbell event is injected locally. The official Ring simulator was not
  evaluated, so no claim is made about matching its payloads.
- **Speech recognition accuracy** across accents, and speech synthesis voices, beyond
  Chromium's defaults.
- **Load, concurrency and long-running stability.** This is a single-household hackathon
  build; nothing has been soak-tested.
