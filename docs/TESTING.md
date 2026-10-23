# What was tested, and what was not

## Automated tests

```bash
npm test          # or: npx vitest run -w @alongside/server
```

**75 tests across 6 files**, all passing on the last run. They use an on-disk SQLite file per
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
- **The Fire TV app running on an Android TV emulator** (API 36, 1920×1080, x86_64), driven
  entirely through `adb shell input keyevent` — that is, real D-pad and select key events,
  not synthetic taps. Exercised: first-run setup and pairing; the home screen rendering the
  live snapshot with the caregiver's photo; Start; "Done, what is next" confirming a step
  and advancing; the progress dots and step counter; "Something is different" returning the
  caregiver-approved alternative; a help request reaching the dashboard with the right
  activity and step attached; the demo-clock announcement arriving over the WebSocket; and
  Back behaving as it should. Four defects were found this way and fixed — see below.

### What running it on a television actually caught

None of these would have been found by a test or by reading the code. They are the argument
for doing this pass rather than trusting a green build.

1. **The setup screen trapped you.** Dismissing the on-screen keyboard left the text field
   holding Android's focus, so the directional pad stopped moving the highlight and the
   remote appeared to have died. Fixed by blurring explicitly, closing the field when the
   keyboard hides, and handling Back while editing.
2. **The server address was pre-filled**, which meant deleting 24 characters with a remote
   before you could type your own. Now empty, with the placeholder doing the work.
3. **The step screen overflowed and drew over itself** — the caption band landed on top of
   the instruction text. React Native defaults `flexShrink` to `0`, unlike the web, so an
   over-tall row overflows instead of giving way. Fixed across the vertical stack.
4. **Choosing a listed situation was re-interpreted as speech.** The television sends the
   caregiver's own wording for the alternative the person picked; run back through speech
   classification it came out as "Sorry, I didn't quite catch that" — the one place the
   product must not fumble. A choice made on screen now carries a declared intent, and the
   speech classifier also learned the "it is not in the fridge" shape.
5. **The help confirmation never appeared**, because the shared action helper cleared the
   message *after* the action had set it. The person was told nothing after asking for help.

## Not verified

- **Physical Fire TV hardware.** The emulator pass above covers layout, focus, D-pad input
  and the whole backend contract, but it is an Android TV image rather than Fire OS, and no
  Fire TV device was attached. What remains device-specific: the app's appearance on the
  Fire TV home row with its banner, a physical remote's key mapping, and real-network
  behaviour. [FIRETV.md](FIRETV.md) has that as a short checklist.
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
