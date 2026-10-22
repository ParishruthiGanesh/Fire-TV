# Prepared submission answers

Drafts for the submission form, for review before anything is sent. **Nothing here has been
submitted, published or shared, and no repository invitations have been sent.**

---

## Project name

**Alongside**

## Tagline

A conversational daily companion that helps older adults living alone follow their own
routines, understand each step, and ask for help.

## Which track(s) and mini challenge(s)

**Primary track: Fire TV.**

**Mini challenges: none claimed.** Both were considered and neither is honestly ours yet:

- *AWS Builder* — an Amazon Bedrock provider is implemented and selectable with one
  environment variable, but it has not been run against a live Bedrock account in this build,
  so there is no verified AWS integration to document. It becomes claimable the moment it is
  run with credentials and model access.
- *Open Source* — this repository is Apache 2.0 licensed, but the challenge asks for a *new,
  additional* open-source project or a contribution to a public repository alongside the
  primary submission. Licensing the submission itself does not meet that on a plain reading.
  A natural candidate would be extracting the dependency-free Streamable HTTP MCP server into
  its own package; it has not been done.

## Project description

Anna's mother Mary is eighty-one and lives on her own. Mary is sharp and independent, and she
still gets stuck — not because she has forgotten how to make breakfast, but because the
morning has a lot of small steps and nobody is there to say which one is next. Anna has
explained it a hundred times.

**Alongside is for the hundred-and-first.**

Anna describes a routine once, the way she would describe it to a neighbour, and uploads the
photo that makes it obvious which container she means. AI turns that into a structured
proposal — the time, the days, the steps, what to say if something is not where it should be
— and, importantly, **asks about what Anna did not say** rather than filling it in. *"What
preparation instructions should I give Mary?"* Anna reviews exactly what the assistant will
say and what the television will show, then publishes. Nothing runs until she does.

The next morning Mary's television shows one thing: a greeting, Anna's photo, one
instruction, and a few large buttons. She can press them with the remote or just talk. She
can ask what she is having, ask for the next step, say *"give me fifteen minutes"*, say
*"the container isn't there"* — and get Anna's own approved answer about the packets in the
pantry — or ask for help, which appears on Anna's dashboard immediately with the activity
and the step attached.

If Mary wanders off and comes back, Alongside says *"You were on step two. Would you like to
continue?"*, because showing an instruction is not the same as finishing it, and this product
only counts what Mary actually confirmed.

**How it works.** One Node backend owns the truth: a SQLite store that distinguishes a
routine *template* from each day's *occurrence*, server-side scheduling, Server-Sent Events
for the browsers and a WebSocket for the television, idempotency keys so a repeated speech
result cannot act twice, and version checks so a stale screen cannot overwrite a newer one.
The Fire TV app is React Native built to a real Fire OS APK with a leanback launcher and
D-pad navigation. The conversational surface is a web voice client — labelled on every screen
as an **Alexa+ experience simulation** — with real microphone input, real spoken replies,
push-to-talk and a typed fallback. A self-hosted Streamable HTTP MCP server (protocol
`2025-11-25`) exposes the same validated actions to any MCP client.

The AI is asked exactly three questions — what did this caregiver describe, what did this
person just say, and which approved alternative fits — and every answer is schema-checked.
**The model never writes to the database.** The server maps an understood intent onto a
validated command, and replies are composed from published text. When Alongside does not
know something, it says so: *"I don't have a note about that, and I can't see the room, so I
don't want to guess."*

## What we built during the hackathon window

Everything. The repository was empty at the start: the shared domain package, the backend,
the caregiver dashboard and routine builder, the Alexa+ experience simulation, the Fire TV
React Native app including its native remote-control bridge, the MCP server, the three AI
providers, the generated demo imagery, 73 automated tests, and the documentation.

## Repository

*(Fill in the URL.)* The repository must either be public with an open-source licence — one
is included (`LICENSE`, Apache 2.0) — or private and shared with `testing@devpost.com` plus
the reviewer accounts `knmeiss`, `giolaq`, `anishamalde`, `mosesroth` and `emersonsklar`
via **Settings → Collaborators → Add people**. Invitations expire after seven days, so add
them when you submit. **No invitations have been sent from here.**

## Demo video

*(Fill in the YouTube or Vimeo URL — public, in English, under three minutes.)* The script
and shot list are in [DEMO.md](DEMO.md). The Fire TV footage must show the app running on a
Fire TV device or the Fire TV/Vega simulator, not the browser mirror.

## Product feedback

See [FEEDBACK.md](FEEDBACK.md) — Fire TV and Fire OS, Alexa+ and MCP, Ring, AWS/Bedrock, the
Anthropic API, React Native and Metro, the Android toolchain, the Web Speech API, and the
backend and test libraries. Each covers what it was used for, what worked, what needs work,
how onboarding felt, and whether we would use it again. Where something was written against
documentation but not run live, that is stated.

## Friction log

See [FRICTION_LOG.md](FRICTION_LOG.md) — nine entries, each with the task, the steps, what
was expected, what happened, a severity rating, the workaround used, and a specific
suggestion. The three that cost the most: the Fire TV manifest documentation page returning
404, React Native's TV support living in a fork that the track materials do not mention, and
there being no way to run a Fire TV app in a cloud build environment.

## Feature requests

1. **A browser-hosted Fire TV simulator.** *Critical.* The Android TV emulator needs hardware
   acceleration, which cloud build environments do not provide, so teams working on hosted
   machines cannot launch their app at all. Even a screenshot-only simulator would change
   that.
2. **An MCP conformance checker for Alexa+.** *Important.* A tool that performs an initialize
   handshake and a `tools/list` against a URL and reports what it found would let teams
   verify their server without Preview access.
3. **A current Fire TV manifest checklist page.** *Important.* Required and not-required
   features, banner sizes, launcher categories, a Fire OS → API level table, and the
   `aapt2 dump badging` check.
4. **A "React Native on Fire TV" page that names the `react-native-tvos` fork.** *Important.*
   With forty lines of sample Kotlin for teams that stay on upstream.
5. **A no-account Ring event simulator with documented payloads.** *Nice to have.* We wanted
   to model one real event type and could not confirm its shape, so we built a labelled local
   simulator instead.
6. **A "what MCP does and does not give you" section.** *Important.* Specifically: an
   ordinary Alexa conversation does not reach your server, and an MCP server alone does not
   enable proactive speech on an Echo or control of a Fire TV app.

## Things we are explicitly not claiming

- The voice client is **not** Alexa. It is Alongside's own web voice client, labelled as an
  Alexa+ experience simulation on every screen.
- The MCP server has **never served a request from Alexa+**. Its transport is tested; the
  remaining dependencies are listed in [INTEGRATIONS.md](INTEGRATIONS.md).
- The Ring event is **simulated locally** and carries only the fields a doorbell press
  actually carries. No Ring account, SDK, video or unlocking.
- Help requests are **dashboard records**. Nothing is emailed, texted or pushed, and no
  screen says otherwise.
- The Fire TV app **builds and its manifest is verified**, but it has not been launched on
  hardware or an emulator from this environment. See [TESTING.md](TESTING.md).
