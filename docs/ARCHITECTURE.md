# Architecture

## The one idea

Three surfaces — a television, a voice client and a caregiver's dashboard — can only be
trusted if they cannot disagree. So there is exactly one authoritative backend, exactly one
shape of state (`HouseholdSnapshot`), and exactly one set of commands that may change it.
Nothing renders anything it worked out for itself.

```
packages/shared     the domain model, zod schemas and timezone helpers
apps/server         the only thing that writes
apps/web            caregiver dashboard · routine builder · Alexa+ simulation · TV mirror
apps/firetv         React Native app for Fire OS
```

## Stack and why

| Choice | Why |
| --- | --- |
| TypeScript everywhere, one shared package | The TV app, the web app and the backend import the same `Routine` and `OccurrenceView`. A field that changes meaning breaks the build rather than the demo. |
| Node + Express | Boring, fast to iterate, and the whole surface is plain HTTP that is easy to read in a review. |
| SQLite (better-sqlite3) | One household, one device, synchronous transactions, a single file to back up or reset. Nothing here needs a server database. |
| SSE for browsers, WebSocket for the TV | Browsers reconnect `EventSource` for free. React Native has neither `EventSource` nor streaming `fetch`, so the TV app gets the same events over a WebSocket, with polling as a fallback. |
| React Native for Fire TV | Shared types with the backend, and a real Android APK for Fire OS rather than a web page in a TV-shaped window. |
| zod | The boundary between "a model said something" and "the database believes something". |

## Data model

Stored in SQLite; see `apps/server/src/db.ts` for the schema and
`packages/shared/src/domain.ts` for the types.

| Table | Holds |
| --- | --- |
| `households` | name, IANA timezone, pairing code |
| `caregivers` | the family member, and their access token |
| `profiles` | the older adult: preferred name, language, photo, text size, speech speed |
| `devices` | each paired television or voice client, with its own scoped token |
| `media_assets` | uploaded or generated reference images, audio and video |
| `routine_drafts` | AI proposals, the caregiver's own words, and what is still missing |
| `routines` | **published** routines, versioned |
| `routine_steps` | the ordered approved instructions |
| `routine_alternatives` | caregiver-approved answers for "something is different" |
| `routine_overrides` | one-day changes that must not touch the recurring schedule |
| `occurrences` | one row per routine per local date — the thing that actually has state |
| `conversation_sessions` / `conversation_turns` | transcripts per surface, and the pending offer so "yes" has a referent |
| `help_requests` | tracked separately from occurrences, on purpose |
| `activity_events` | the caregiver's readable history |
| `idempotency` | stored responses, keyed by household, scope and key |
| `ring_events` | simulated doorbell events |

### Templates versus occurrences

A `routine` is a template. An `occurrence` is one day's instance of it, materialised three
days ahead. This distinction is what makes the hard requirements possible:

- postponing changes one occurrence's `due_at`, and nothing else;
- a one-day override changes one occurrence, and nothing else;
- republishing a routine bumps its `version`, and occurrences keep the version they were
  made from, so a change tomorrow does not rewrite what happened this morning;
- progress, self-reports and confirmations have somewhere durable to live.

### Occurrence states

```
scheduled ──► in_progress ──► completed_self_report
    │   ▲          │
    │   └──────────┤ (resume picks up after the last confirmed step)
    ├──► postponed ┘
    ├──► skipped
    └──► completion_unconfirmed
```

`completion_unconfirmed` means **"we asked and heard nothing"** — nothing more. It is only
reachable from an occurrence that was actually announced, so publishing a routine whose
time has already passed never stamps it. It is never described as a problem with the person,
and no screen infers a fall, an illness or an emergency from silence.

### Showing a step is not finishing it

Every occurrence carries two indices:

- `current_step_index` — what is on the screen;
- `confirmed_step_index` — the last step the person actually said they had finished.

Displaying, reading aloud, repeating and going back all move the first. Only an explicit
act by the person — "done", "what's next", pressing the button — moves the second. Resuming
after an interruption starts at `confirmed + 1`, which is why
*"You were on step two. Would you like to continue?"* is accurate rather than a guess.

## Synchronisation

- **Server-side scheduling.** A sweep every five seconds finds occurrences that are due,
  announces them once, and pushes the announcement to every connected client. Clients render
  what the sweep decided; they never decide for themselves.
- **One snapshot.** Every change republishes the whole `HouseholdSnapshot` to the household.
  It is small, and it removes a whole class of "my client applied events in the wrong order"
  bugs.
- **Reconnection.** On connect, a client receives the current snapshot before anything else,
  so it is never catching up on a replay. The TV app falls back to polling while its socket
  is down and shows "Not connected" rather than stale state.
- **Idempotency.** Every mutating call accepts an `idempotencyKey`. A repeated key replays
  the stored response instead of applying the change again. Help requests also de-duplicate
  on an identical message within two minutes, because a duplicated speech result often
  arrives without a key.
- **Version checks.** Occurrences carry a `version`. A client may send `expectedVersion`;
  if the server has moved on it answers `409` with the current state instead of letting a
  stale screen overwrite a newer one.
- **Household timezone.** Schedules are stored as local wall-clock times plus an IANA zone
  and resolved to instants on demand, so 08:00 stays 08:00 across a daylight-saving change.
  Postponements are stored as absolute instants, so they survive one.
- **Demo clock.** A signed offset per household, applied to every server-side time decision
  and to every domain timestamp. Any surface showing a non-zero offset displays a badge.

## The AI layer

`apps/server/src/ai/` holds one interface and three implementations.

```ts
interface AiProvider {
  extractDraft(input): Promise<DraftExtraction>;      // caregiver conversation -> structured draft
  understandTurn(input): Promise<TurnUnderstanding>;  // one utterance -> an intent
  matchAlternative(input): Promise<AlternativeMatch>; // a situation -> an approved answer, or none
}
```

- **`local`** — deterministic rules. Needs no credentials, which is what makes the demo
  reproducible and keeps the hosted providers honest: they must return the same schema.
- **`anthropic`** — Claude via the Messages API, with a single tool and `tool_choice` forcing
  structured output.
- **`bedrock`** — Claude via Amazon Bedrock's Converse API, same tool schemas.

A hosted provider that errors, times out or returns something the schema rejects falls back
to the deterministic one and records why; the dashboard shows the count. The product keeps
working with buttons and approved text, which matters more here than a clever sentence.

**The model never writes to the database.** It reports what it understood; the server maps
that onto a validated command. Replies are composed from published text. The runtime
assistant tags every answer with provenance — `caregiver_approved`, `user_reported` or
`unknown` — and surfaces show it.

## Access boundaries

Every request resolves to a household through a bearer token: the caregiver's, or a device
token minted by exchanging the pairing code. Every query is scoped by household id, so an
occurrence or a media asset id from another household simply does not exist. Caregiver-only
routes (publishing, the demo clock, uploads, overrides) additionally require the caregiver
role; a paired television gets `403`. Tokens can also be passed as `?token=` for the two
cases a browser cannot send headers: `EventSource` and `<img src>`.

## What is deliberately absent

- No background observation. Reminders run while Alongside is open; the app cannot wake a
  powered-off television, interrupt another app, or speak through a separate Echo, and
  nothing in the product claims otherwise.
- No inference from photographs. Uploaded images are visual aids. Medication identity,
  doses and appliance settings are shown only when a caregiver typed them.
- No message delivery claims. A help request is a record on a dashboard, and every surface
  says so in those words.
