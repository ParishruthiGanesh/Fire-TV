# Known limitations and production follow-up work

Written plainly. A product for someone's parent should be honest about where it stops.

## Scope of this build

- **One household, one older adult, one caregiver.** Household identity is explicit in every
  table and every query, so a second household works today, but there is no household
  switcher, no invitations, and no second caregiver.
- **Authentication is a bearer token.** The caregiver's token comes from an environment
  variable and devices exchange a pairing code for their own token. Every request is scoped
  to a household and caregiver-only routes are enforced, but there is no sign-in, no
  password, no session expiry and no rotation beyond regenerating the pairing code. A real
  deployment needs proper identity.
- **Plain HTTP on a LAN.** The TV app sets `usesCleartextTraffic` because the backend serves
  HTTP on a home network. Production needs TLS and that flag removed.
- **SQLite, single process.** Correct for one household; it is not a multi-tenant store.
- **No backup, export or deletion flow** beyond deleting the database file and the
  "delete the recording" control on a draft's voice note.

## Product gaps

- **Reminders only reach surfaces that are open.** Alongside cannot wake a powered-off
  television, interrupt another app, or speak through a separate Echo. The server decides
  that a routine is due whether or not anyone is connected, and announces it once to whoever
  is listening — but if nothing is listening, nobody hears it.
- **Help requests are dashboard records.** No email, SMS or push. Adding real delivery needs
  a configured provider, a tested failure path, and a visible distinction on screen between
  *recorded* and *delivered*. Building half of that would be worse than not building it.
- **No escalation.** If a help request is never acknowledged, nothing happens. A real product
  needs a second contact and a timeout, designed with families rather than guessed at.
- **English only.** The profile carries a language and the voice client passes it to speech
  recognition and synthesis, but all composed text is English.
- **One older adult per household.** Couples are common and not modelled.
- **No medication-specific handling** beyond refusing to infer anything. Medication routines
  work as ordinary routines with caregiver-written instructions; a real product in this space
  needs pharmacist review, not just good intentions.
- **No accessibility pass beyond size and contrast.** Screen-reader behaviour on Fire TV,
  hearing-aid pairing and colour-vision variants are untested.
- **The demo clock is a per-household global.** It makes recording a demo possible; it is not
  something that should exist in a shipped build, and it should be compiled out.

## Technical follow-up

- **Verify on Fire TV hardware.** The APK builds and its manifest is right, but the on-device
  visual and input pass has not been run — see [FIRETV.md](FIRETV.md) for the checklist and
  [TESTING.md](TESTING.md) for exactly what was and was not verified.
- **Run the hosted AI providers against live endpoints.** The Anthropic and Bedrock adapters
  are written and schema-validated but have never been called for real.
- **Media is unbounded.** No quota, no image resizing, no thumbnails. A caregiver uploading
  fifty photographs from a modern phone would fill a disk and make the television app
  download multi-megabyte images.
- **Idempotency records are never pruned.** The table grows forever.
- **Occurrences are materialised three days ahead** by whatever request happens to ask for a
  snapshot. That is fine at this size and is not how it should work at any other size.
- **The event stream republishes the whole snapshot** on every change. Simple and
  order-independent, and it would need to become incremental for a household with a year of
  history.
- **The deterministic AI provider is English-specific and rule-based.** It is deliberately
  conservative and reports what it cannot parse, but it will not understand an unusual
  phrasing that a model would. Switching providers is one environment variable, which is the
  point of the adapter.
- **No rate limiting anywhere.**
- **The MCP endpoint's auth is a household bearer token.** Right for a local client, not what
  a consumer integration should use.
- **No structured logging, metrics or error reporting.**

## Things deliberately not built

These are not oversights; building them would have made the product worse or dishonest.

- Inferring a fall, an illness or an emergency from silence.
- Treating a displayed or spoken instruction as a completed one.
- Reading medication identity, doses or appliance settings out of a photograph.
- Claiming a message was delivered when a database row was written.
- Removing a recurring routine because the person declined it once.
- Any always-listening behaviour, or any suggestion that the product can see the room.
