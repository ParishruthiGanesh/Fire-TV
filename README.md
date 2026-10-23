# Alongside

**A conversational daily companion that helps older adults living alone follow their own
routines, understand each step, and ask for help.**

A trusted family member explains the routines once, in their own words, and uploads the
photos that make them obvious. AI turns that into a structured proposal. The family member
reviews it and publishes it. From then on the older adult gets calm, large-type guidance on
Fire TV and can simply talk to the assistant — and every answer they give updates the
television, the routine's progress and the caregiver's dashboard through one shared backend.

> Tell it once. Review it. Help my family member through their day.

**Primary hackathon track: Fire TV.** The Fire TV app is a React Native application for
Fire OS, built as an installable APK from this repository.

---

## What is real and what is simulated

This matters more than anything else in this README, so it is first.

| Piece | Status |
| --- | --- |
| **Fire TV app** | **Real.** React Native 0.76 → Android/Fire OS. Builds to `app-release.apk`, installs with `adb install`, leanback launcher, D-pad navigation, no touch required. |
| **Backend, scheduling, sync** | **Real.** Node + SQLite, SSE for browsers, WebSocket for the TV, server-side scheduling, idempotency and version checks. |
| **Caregiver dashboard** | **Real.** React web app, works on a phone or a laptop. |
| **Alexa+ experience** | **Simulation**, the route the hackathon permits for people not in the Alexa+ Preview. Alongside's own web voice client: real microphone input, real spoken output, push-to-talk, text fallback. It is labelled as a simulation on screen, everywhere. It is **not** Amazon Alexa and does not run on an Echo. |
| **MCP server** | **Real code, unconnected.** A self-hosted Streamable HTTP MCP server at `/mcp`, protocol revision `2025-11-25`, with tests covering the transport. It has **not** been connected to a live Alexa+ account — that needs Preview access we do not have. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). |
| **AI** | **Real, two ways.** A deterministic rule-based provider that needs no credentials (what the demo runs on), and hosted Claude providers via the Anthropic Messages API or Amazon Bedrock, selected with one environment variable. All three return the same schema-validated structures. |
| **Ring** | **Simulated and labelled.** A local endpoint injects one doorbell event carrying only the fields a real "ding" carries. No Ring account, no Ring cloud, no video, no unlocking. |
| **Notifications** | **Dashboard only.** A help request creates a record the caregiver sees immediately. No SMS, email or push is sent, and no screen ever claims one was. |

Full detail, including exactly what would be needed to make the Alexa+ and Ring
integrations real, is in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

---

## Quick start

Requirements: Node 20+ (22 recommended) and npm 10+. For the Fire TV app you also need
JDK 17+ and the Android SDK.

```bash
git clone <this repository>
cd Fire-TV
cp .env.example .env          # no secrets needed for the default demo
npm install

# seeds the demo household if needed, starts everything, and prints the
# pairing code and every URL you need
./scripts/demo.sh
```

Then open:

| URL | Who it is for |
| --- | --- |
| http://localhost:5173/ | **Anna** — the caregiver dashboard |
| http://localhost:5173/builder | the conversational routine builder |
| http://localhost:5173/voice | **Mary** — the Alexa+ experience simulation |
| http://localhost:5173/tv | a browser mirror of the television (not the Fire TV app) |
| http://localhost:5173/settings | household, pairing code, demo clock, integrations |

The seed prints the **pairing code** and the caregiver token. The dashboard is pre-filled
with the development token, so it works immediately.

Use Chrome or Edge for the voice client: Safari and Firefox have no `SpeechRecognition`,
and the page falls back to typing (which goes through exactly the same backend).

### The Fire TV app

```bash
cd apps/firetv
npm install
npm run build:release          # android/app/build/outputs/apk/release/app-release.apk
adb connect <fire-tv-ip>:5555
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

On first launch the app asks for the backend address (`http://<your-computer-ip>:4000`)
and the six-character pairing code. Full instructions, including the Android TV emulator
route and what has and has not been verified on hardware, are in
[docs/FIRETV.md](docs/FIRETV.md).

---

## How the pieces fit together

```
                    ┌──────────────────────────────┐
  Anna  ──────────► │  Caregiver dashboard (React) │ ──┐
  phone / laptop    │  conversational builder      │   │  REST + SSE
                    └──────────────────────────────┘   │
                                                       ▼
  Mary  ──────────► ┌──────────────────────────────┐  ┌──────────────────────┐
  television        │  Fire TV app (React Native)  │─►│  Alongside backend   │
                    └──────────────────────────────┘  │  Node · Express      │
                           REST + WebSocket           │  SQLite · scheduler  │
                                                      │  AI adapter          │
  Mary  ──────────► ┌──────────────────────────────┐  │  MCP (Streamable     │
  voice             │  Alexa+ experience simulation│─►│       HTTP, 2025-11-25)
                    └──────────────────────────────┘  └──────────────────────┘
                           REST + SSE                            │
                                                                 ▼
                                                        one authoritative state
```

One backend owns the truth. Every surface renders the same `HouseholdSnapshot` and every
change flows back through the same validated commands, so the television, the voice client
and the dashboard cannot tell different stories. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
goes through the data model, the occurrence state machine and the synchronisation rules.

### Why the AI never writes to the database

The model is asked exactly three questions: *what did this caregiver describe?*, *what did
this person just say?*, and *which caregiver-approved alternative fits this situation?*
Each answer is parsed through a zod schema; anything that fails is rejected. The server then
decides which **validated command** that means for the current occurrence — start, advance a
confirmed step, postpone, complete, skip, raise a help request — and only those commands
touch state. Free-form model text is never stored as an instruction and never read aloud as
if a caregiver had approved it. Replies are composed from published text.

When the assistant does not know something, it says so. There is no fallback to general
knowledge about where somebody's medication might be.

---

## Repository layout

```
packages/shared     domain types, zod schemas, timezone helpers — used by all three apps
apps/server         Node backend: SQLite, scheduler, SSE + WebSocket, AI adapter, MCP
apps/web            React: caregiver dashboard, routine builder, Alexa+ simulation, TV mirror
apps/firetv         React Native app for Fire OS
demo-assets         generated reference images (run `npm run demo:assets -w @alongside/server`)
docs                architecture, integrations, Fire TV setup, demo script, feedback, limits
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | backend and web app together |
| `npm run seed -w @alongside/server` | create the demo household (add `-- --with-breakfast` to seed breakfast too) |
| `npm run reset -w @alongside/server` | delete the database and uploads |
| `npm test` | the full backend test suite, including the nineteen-step demo flow |
| `npm run typecheck` | TypeScript across shared, server and web |
| `npm run build` | production build of shared, server and web |
| `npm run build:release -w @alongside/firetv` *(from `apps/firetv`)* | the Fire TV APK |

## Documentation

- [docs/LAPTOP_DEMO.md](docs/LAPTOP_DEMO.md) — run all three surfaces on one laptop, with no Fire TV hardware
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model, state machine, synchronisation
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — real vs simulated, and the exact remaining dependencies
- [docs/FIRETV.md](docs/FIRETV.md) — building, installing and running on Fire OS or an emulator
- [docs/DEMO.md](docs/DEMO.md) — the demo script, shot list and reset instructions
- [docs/SAFETY.md](docs/SAFETY.md) — the rules about what this product will not claim or infer
- [docs/TESTING.md](docs/TESTING.md) — what is tested, what was verified by hand, what is unverified
- [docs/FEEDBACK.md](docs/FEEDBACK.md) — product feedback on every tool, API and SDK used
- [docs/FRICTION_LOG.md](docs/FRICTION_LOG.md) — friction encountered while building this
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — known limitations and production follow-up work
- [docs/SUBMISSION.md](docs/SUBMISSION.md) — prepared answers for the submission form

## Licence

Apache 2.0 — see [LICENSE](LICENSE). The demo imagery is generated by this repository's own
code and contains no third-party material.
