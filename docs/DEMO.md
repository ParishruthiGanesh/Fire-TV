# Demo

## Setting up (about three minutes)

```bash
npm install
npm run reset -w @alongside/server          # only if you have run it before
npm run seed  -w @alongside/server          # prints the pairing code
npm run dev                                 # backend :4000, web :5173
```

The seed creates the Whitaker household: **Mary** (lives alone) and **Anna** (her
daughter), with two routines already published — *Getting ready* on weekdays at 09:00 and a
*Family call* every day at 16:30 — plus nine generated reference images.

**Breakfast is deliberately not seeded.** Anna builds it live, which is the point of the
product. If you want it pre-built (for a rehearsal, or to skip to the runtime half):

```bash
npm run seed -w @alongside/server -- --with-breakfast
```

Open three windows before you start recording:

| Window | URL |
| --- | --- |
| Anna's dashboard | http://localhost:5173/ |
| Mary's voice client | http://localhost:5173/voice (pair with the code) |
| The television | the Fire TV app, or http://localhost:5173/tv as a mirror |

Use Chrome or Edge for the voice client, and allow microphone access before recording.

### The demo clock

Nobody wants to wait until eight in the morning. **Household → Demo clock** jumps the
household's time: set it to `07:55`, then press `+5 min` when you want breakfast to come
due. Every surface shows an amber *Demo clock* badge the whole time it is running, so a
viewer always knows the time on screen is not real time. `Back to real time` clears it.

### Resetting between takes

```bash
npm run reset -w @alongside/server && npm run seed -w @alongside/server
```

That deletes the database and uploaded media and recreates the demo household with a new
pairing code — so re-pair the television and the voice client afterwards. If you only want
to re-run the morning, moving the demo clock backwards is enough: occurrences that are back
in the future are re-armed automatically.

---

## The script (2 minutes 40 at an unhurried pace)

> Spoken narration in **bold**, what is on screen in plain text.

### 0:00 — The problem (0:15)

**"Mary is eighty-one and lives alone. Her daughter Anna has explained the morning a hundred
times. Alongside is for the hundred-and-first."**

Dashboard, quiet: *Mary's day*, two routines, nothing alarming.

### 0:15 — Tell it once (0:40)

**"Anna describes breakfast the way she'd say it to a neighbour."**

In the routine builder, type or paste:

> Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the
> fridge. Use this photo to show her which one. Ask if she wants preparation help. If she
> says later, ask again in fifteen minutes.

Attach `demo-assets/yellow-container-in-fridge.png`.

The preview fills in: Breakfast · Weekdays · 8:00 AM. Then the assistant asks:

> **What preparation instructions should I give Mary?**

**"It didn't invent the steps. It asked."**

Reply:

> Take the yellow container out of the fridge from the middle shelf. Tip the oatmeal into a
> bowl and add milk up to the line. Heat it in the microwave for two minutes, then give it a
> stir. If the yellow container isn't there, there are oatmeal packets in the pantry on the
> second shelf.

Four steps and one approved alternative appear. Note that "two minutes" did not become the
time.

### 0:55 — Change it, then publish (0:20)

Type: **"Make it eight thirty instead."** The time changes; the steps stay.

**"Anna reviews exactly what the assistant will say and what the television will show — and
nothing runs until she publishes."**

Press **Publish this routine**. It appears under *Published routines*, v1.

### 1:15 — The morning (0:35)

Set the demo clock to 07:55, then `+5 min`. Cut to the television.

Assistant, aloud: **"Good morning, Mary. It's breakfast time. Would you like me to show you
where it is?"**

Mary (into the voice client): **"Yes. What am I having?"**

Assistant: **"Here's the first step. Mary's oatmeal is in the yellow container on the middle
shelf of the fridge. Take the yellow container out of the fridge — it is on the middle
shelf."** The television shows Anna's photo and step 1 of 3.

Mary: **"Give me fifteen minutes."** → **"Okay. I'll remind you in fifteen minutes."**

Cut to the dashboard: *Postponed*. Cut back to the television: *Postponed*.

**"One morning moved. The recurring routine is untouched."**

### 1:50 — Picking up where she left off (0:25)

On the television, press **Continue**, then **Done, what is next**. Step 2 appears.

Close the app and reopen it (or refresh the mirror).

**"You were on step two. Would you like to continue?"**

**"Showing a step isn't finishing it. Alongside only counts what Mary actually confirmed."**

### 2:15 — When the world doesn't match the plan (0:20)

Mary: **"The container isn't there."**

Assistant: **"There are oatmeal packets in the pantry, on the second shelf. One packet with
milk works just the same. Would you like me to ask Anna for help as well?"**

**"That's Anna's own sentence, approved in advance. When Alongside doesn't know, it says so
instead of guessing."**

Mary: **"Yes please."**

Dashboard, instantly: **Help requested** — "Breakfast · step 2". Anna presses
**Acknowledge**.

**"A record on Anna's dashboard. It doesn't claim to have sent a text it never sent."**

### 2:35 — Finishing (0:10)

Mary: **"I already ate."** → **"Thanks for telling me — I've marked breakfast as done."**

All three screens: *Completed (self-reported)*.

**Close on the dashboard.** **"Tell it once. Review it. Help my family member through their
day."**

---

## Shot list

Keep the Fire TV footage genuine: the requirement is to show the app running on Fire OS or
the Fire TV / Vega simulator, not a browser window shaped like a television.

| # | Shot | Source | Seconds |
| --- | --- | --- | --- |
| 1 | Dashboard, calm overview | browser, 1440×900 | 10 |
| 2 | Routine builder: Anna types, photo attaches, AI asks its question | browser | 30 |
| 3 | Close-up of the follow-up question | browser, zoomed | 5 |
| 4 | Anna supplies the steps; preview fills in | browser | 15 |
| 5 | "Make it eight thirty instead." | browser | 8 |
| 6 | Publish, routine appears | browser | 8 |
| 7 | Demo clock → 07:55 → +5 min | browser | 6 |
| 8 | **Fire TV: breakfast comes due, photo and step 1** | **device or emulator capture** | 15 |
| 9 | Voice client: "Yes. What am I having?" with the mic state visible | browser | 12 |
| 10 | **Fire TV showing the same step** | **device capture** | 6 |
| 11 | "Give me fifteen minutes" → television and dashboard both change | split or cut | 12 |
| 12 | **Fire TV: Continue → Done → step 2**, operated with the remote | **device capture** | 15 |
| 13 | Reopen the app → "You were on step two" | **device capture** | 10 |
| 14 | "The container isn't there" → approved alternative | browser + device | 14 |
| 15 | Help request appears on the dashboard; Anna acknowledges | browser | 12 |
| 16 | "I already ate" → all three screens agree | cut between all three | 12 |

**Capturing the Fire TV screen.** From a device:

```bash
adb connect <fire-tv-ip>:5555
adb shell screenrecord --bit-rate 8000000 /sdcard/alongside.mp4   # Ctrl-C to stop
adb pull /sdcard/alongside.mp4
```

From an emulator, record the emulator window directly. Either way, include a moment where
the physical remote or the emulator's D-pad is visibly driving the highlight — that is the
part a browser mock cannot fake.

**Keep it clean:** no third-party music, no trademarks, no copyrighted footage. The
reference images in `demo-assets/` are generated by this repository's own code.

---

## Regenerating the demo images

```bash
npm run demo:assets -w @alongside/server     # writes demo-assets/
```

They are drawn by `apps/server/src/scripts/demo-assets.ts` and every one is stamped
*"DEMO REFERENCE IMAGE — REPLACE WITH A REAL PHOTO"*. Replace them with real photographs
through the dashboard's upload control whenever you like; nothing depends on the generated
ones.
