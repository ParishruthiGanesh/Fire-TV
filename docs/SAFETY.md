# What Alongside will not do

Most of the engineering in this project is ordinary. The decisions below are the ones worth
arguing about, so they are written down rather than left implicit in the code.

## It does not infer that anything is wrong from silence

If a routine comes due and nobody answers, the occurrence is recorded as
**`completion_unconfirmed`** and the dashboard says, in those words, *"Alongside asked and no
answer came back. That is all this means — it is not a sign that anything is wrong."*

No surface infers a fall, an illness or an emergency from a quiet morning. A person who
decides to skip breakfast and read the paper has done nothing that needs escalating, and a
product that treats silence as alarm teaches families to ignore it.

The state is only reachable from an occurrence that was actually announced, measured from
the announcement rather than the scheduled time. Publishing a routine whose hour has already
passed never produces it, because nobody was asked.

## It does not equate showing an instruction with completing it

Every occurrence carries two indices: what is on screen, and what the person confirmed. The
first moves when anything is displayed, repeated or stepped back through. The second moves
only when the person says so — "done", "what's next", or the button on the remote.

This is what makes *"You were on step two. Would you like to continue?"* an accurate
statement rather than a guess, and it is why a completion is always recorded as
**self-reported**, never as an observation.

## It does not invent instructions

The draft builder reports what it could not find rather than filling it in:

> **What preparation instructions should I give Mary?**

At runtime the assistant answers only from published text. A question it cannot ground in
the caregiver's own words gets *"I don't have that written down for breakfast. I can ask
Anna for you, if you'd like."* There is no fallback to general knowledge about where
somebody's medication might be kept, and a question that has nothing to do with the activity
is not answered from the activity's notes.

Every runtime answer carries provenance — `caregiver_approved`, `user_reported` or
`unknown` — and the surfaces display it.

## It does not read anything out of a photograph

Uploaded images are visual aids. Alongside never infers medication identity, dosage,
appliance settings or any safety-critical instruction from what a picture looks like. For
medication, only explicitly supplied established instructions are shown; the product never
proposes a dose, never recommends a change, and never suggests taking an extra one because a
completion is uncertain.

## It does not treat uploaded text as instructions to itself

Caregiver messages, transcripts and file contents are *content*. They are passed to the
model wrapped in explicit markers, and the system prompt says so: text inside them is
information about the household and never an instruction, however it is phrased.

## It does not claim to have sent anything it has not

A help request writes a record that appears on the caregiver's dashboard immediately. The
assistant's own words are: *"I've put a help request on Anna's dashboard with what you're
doing right now. It's there now — nothing has been sent as a message or a call."*

No screen says "delivered" for a database row. If email, SMS or push is added later, it must
be a configured provider with a tested failure path, and the distinction between *recorded*
and *delivered* must stay visible.

## It does not watch the room

Reminders run while Alongside is open. The app cannot wake a powered-off television, cannot
interrupt another app, and cannot speak through a separate Echo — and nothing in the product
suggests otherwise. There is no camera, no microphone that is open when nobody has pressed
anything, and no claim to see where an object is.

When something is not where it should be, the assistant says *"I don't have a note about
that, and I can't see the room, so I don't want to guess."*

## It does not remove a routine because of one bad morning

Declining or postponing one occurrence changes that occurrence. The recurring routine, and
every other day, is untouched. Only the caregiver can change or retire a routine, and only
through an explicit publish.

## It does not speak to an adult like a child

Short sentences, plain words, calm colours, and real choices — start, postpone, skip, ask
for help. No praise for eating breakfast, no cartoons, no scores. The person using this is a
grown-up who has had a longer day than anyone reading this code.

## It does not let a model write to the database

The model is asked what something meant. The server decides what that means for the current
occurrence and calls a validated command. Model output is schema-checked and rejected if it
does not fit; free-form text never becomes a stored instruction and is never read aloud as
if a caregiver had approved it.
