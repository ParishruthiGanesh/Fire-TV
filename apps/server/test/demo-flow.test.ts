import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHarness, setClock, type Harness } from './helpers.js';
import { Store } from '../src/store.js';
import { openDb } from '../src/db.js';
import { localDateInZone } from '@alongside/shared';

/**
 * The whole demo, start to finish, through the public API.
 *
 * This is the required end-to-end flow written as a test rather than a script,
 * so the thing shown in the video is the thing that is verified on every run:
 * Anna describes a routine, edits it, publishes it; the clock reaches the
 * time; Mary talks to the assistant; the television, the voice client and the
 * dashboard all end up agreeing.
 */

let h: Harness;
afterEach(() => h?.cleanup());

describe('the end-to-end demo', () => {
  it('runs all nineteen steps and leaves every surface agreeing', async () => {
    h = createHarness();
    const caregiver = `Bearer ${h.caregiverToken}`;
    const agent = request(h.app);

    // A television and a voice client each pair with the household code.
    const code = h.store.household(h.householdId).pairingCode;
    const tvPair = await agent.post('/api/pair').send({ code, kind: 'tv', label: 'Living room' });
    expect(tvPair.status).toBe(200);
    const tv = `Bearer ${tvPair.body.token}`;
    const voicePair = await agent.post('/api/pair').send({ code, kind: 'voice' });
    const voice = `Bearer ${voicePair.body.token}`;

    // --- 1. Anna describes breakfast and uploads a photo -------------------
    const photo = h.store.addMediaAsset({
      householdId: h.householdId,
      kind: 'image',
      filename: 'yellow-container.png',
      storedName: 'yellow-container.png',
      mime: 'image/png',
      bytes: 1024,
      caption: 'The yellow container on the middle shelf',
    });

    const first = await agent
      .post('/api/drafts/message')
      .set('authorization', caregiver)
      .send({
        text:
          'Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the fridge. ' +
          'Use this photo to show her which one. Ask if she wants preparation help. ' +
          'If she says later, ask again in fifteen minutes.',
        mediaAssetIds: [photo.id],
      });
    expect(first.status).toBe(200);

    // --- 2. AI creates a structured draft, and asks for what is missing ----
    const draftId = first.body.draft.id;
    expect(first.body.draft.routine.title).toBe('Breakfast');
    expect(first.body.draft.routine.localTime).toBe('08:00');
    expect(first.body.draft.routine.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(first.body.draft.routine.followUpMinutes).toBe(15);
    expect(first.body.draft.routine.heroMediaAssetId).toBe(photo.id);
    expect(first.body.followUpQuestion).toMatch(/preparation instructions/i);
    expect(h.store.listRoutines(h.householdId)).toHaveLength(0); // still not live

    const second = await agent
      .post('/api/drafts/message')
      .set('authorization', caregiver)
      .send({
        draftId,
        text:
          'Take the yellow container out of the fridge from the middle shelf. ' +
          'Tip the oatmeal into a bowl and add milk up to the line. ' +
          'Heat it in the microwave for two minutes, then give it a stir. ' +
          "If the yellow container isn't there, there are oatmeal packets in the pantry on the second shelf.",
      });
    expect(second.body.draft.routine.steps.length).toBeGreaterThanOrEqual(3);
    expect(second.body.draft.routine.alternatives).toHaveLength(1);
    expect(second.body.draft.missing).toHaveLength(0);
    // The duration in "two minutes" must not have been read as a time.
    expect(second.body.draft.routine.localTime).toBe('08:00');

    // --- 3. Anna edits the time conversationally --------------------------
    const edited = await agent
      .post('/api/drafts/message')
      .set('authorization', caregiver)
      .send({ draftId, text: 'Make it eight thirty instead.' });
    expect(edited.body.draft.routine.localTime).toBe('08:30');
    expect(edited.body.draft.routine.steps.length).toBeGreaterThanOrEqual(3);

    // --- 4. Anna reviews and publishes ------------------------------------
    const published = await agent
      .post(`/api/drafts/${draftId}/publish`)
      .set('authorization', caregiver)
      .send({});
    expect(published.status).toBe(200);
    const routineId = published.body.routine.id;
    expect(published.body.routine.version).toBe(1);

    // --- 5. The routine appears on the Fire TV app ------------------------
    const tvSnapshot = await agent.get('/api/snapshot').set('authorization', tv);
    expect(tvSnapshot.status).toBe(200);
    const today = localDateInZone(tvSnapshot.body.now, tvSnapshot.body.household.timezone);
    const todaysBreakfast = tvSnapshot.body.occurrences.find(
      (o: any) => o.routineId === routineId && o.localDate === today,
    );
    expect(todaysBreakfast).toBeDefined();
    expect(todaysBreakfast.routine.steps[0].mediaAssetId).toBe(photo.id);

    // --- 6. The demo clock reaches the scheduled time ---------------------
    setClock(h, '08:29');
    const advanced = await agent
      .post('/api/demo-clock')
      .set('authorization', caregiver)
      .send({ action: 'advance', minutes: 5 });
    expect(advanced.status).toBe(200);
    expect(advanced.body.swept.announced).toBeGreaterThanOrEqual(1);

    // --- 7. The assistant asks Mary about breakfast -----------------------
    const transcript = await agent.get('/api/transcript/voice').set('authorization', voice);
    const announcement = transcript.body.turns.at(-1);
    expect(announcement.role).toBe('assistant');
    expect(announcement.text).toMatch(/breakfast/i);
    expect(announcement.text).toMatch(/would you like/i);

    const occurrenceId = advanced.body.snapshot.focusOccurrenceId;
    expect(occurrenceId).toBe(todaysBreakfast.id);

    // --- 8 & 9. Mary asks a question; voice and TV show the same guidance --
    const answered = await agent
      .post('/api/assistant/turn')
      .set('authorization', voice)
      .send({ text: 'Yes. What am I having?', occurrenceId, surface: 'voice' });
    expect(answered.body.intent).toBe('start');
    expect(answered.body.provenance).toBe('caregiver_approved');
    expect(answered.body.reply).toMatch(/yellow container/i);

    const tvAfterStart = await agent.get('/api/snapshot').set('authorization', tv);
    const onTv = tvAfterStart.body.occurrences.find((o: any) => o.id === occurrenceId);
    expect(onTv.state).toBe('in_progress');
    expect(onTv.currentStepIndex).toBe(0);
    expect(onTv.confirmedStepIndex).toBe(-1); // shown is not finished

    // --- 10. Mary postpones ------------------------------------------------
    const postponed = await agent
      .post('/api/assistant/turn')
      .set('authorization', voice)
      .send({ text: 'Give me fifteen minutes', occurrenceId, surface: 'voice' });
    expect(postponed.body.action).toMatchObject({ kind: 'postpone', minutes: 15 });

    // --- 11. The TV and the dashboard both update --------------------------
    for (const token of [tv, caregiver]) {
      const view = await agent.get('/api/snapshot').set('authorization', token);
      const occurrence = view.body.occurrences.find((o: any) => o.id === occurrenceId);
      expect(occurrence.state).toBe('postponed');
    }
    // The recurring routine is untouched by one postponement.
    expect(h.store.routine(h.householdId, routineId)!.localTime).toBe('08:30');

    // --- 12. Mary resumes and completes a step -----------------------------
    await agent
      .post(`/api/occurrences/${occurrenceId}/start`)
      .set('authorization', tv)
      .send({ surface: 'tv' });
    const confirmed = await agent
      .post(`/api/occurrences/${occurrenceId}/advance`)
      .set('authorization', tv)
      .send({ confirmedStepIndex: 0, surface: 'tv' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.occurrence.confirmedStepIndex).toBe(0);

    // --- 13. The app refreshes and remembers the confirmed step ------------
    const reopened = new Store(openDb(h.dbFile));
    const restored = reopened.occurrence(h.householdId, occurrenceId)!;
    expect(restored.confirmedStepIndex).toBe(0);
    expect(restored.currentStepIndex).toBe(1);
    const resumed = await agent.post(`/api/occurrences/${occurrenceId}/start`).set('authorization', tv).send({});
    expect(resumed.body.occurrence.currentStepIndex).toBe(1);

    // --- 14 & 15. "The container isn't there" -> approved alternative ------
    const different = await agent
      .post('/api/assistant/turn')
      .set('authorization', voice)
      .send({ text: "The container isn't there", occurrenceId, surface: 'voice' });
    expect(different.body.intent).toBe('something_different');
    expect(different.body.provenance).toBe('caregiver_approved');
    expect(different.body.reply).toMatch(/pantry/i);
    expect(different.body.reply).toMatch(/second shelf/i);
    // The activity is still in progress; nothing was silently abandoned.
    expect(h.store.occurrence(h.householdId, occurrenceId)!.state).toBe('in_progress');

    // --- 16. Mary requests help -------------------------------------------
    const helped = await agent
      .post('/api/assistant/turn')
      .set('authorization', voice)
      .send({ text: 'Yes please', occurrenceId, surface: 'voice', idempotencyKey: 'demo-help' });
    expect(helped.body.intent).toBe('request_help');
    expect(helped.body.reply).toMatch(/nothing has been sent/i);
    // A duplicated recognition result must not raise a second request.
    await agent
      .post('/api/assistant/turn')
      .set('authorization', voice)
      .send({ text: 'Yes please', occurrenceId, surface: 'voice', idempotencyKey: 'demo-help' });

    // --- 17. Anna sees and acknowledges it ---------------------------------
    const helpList = await agent.get('/api/help-requests').set('authorization', caregiver);
    expect(helpList.body.helpRequests).toHaveLength(1);
    const helpRequest = helpList.body.helpRequests[0];
    expect(helpRequest.routineTitle).toBe('Breakfast');
    expect(helpRequest.stepIndex).toBe(1);
    expect(helpRequest.status).toBe('open');

    const acknowledged = await agent
      .post(`/api/help-requests/${helpRequest.id}/acknowledge`)
      .set('authorization', caregiver)
      .send({});
    expect(acknowledged.body.help.status).toBe('acknowledged');

    // Help is tracked separately: the activity is still in progress.
    expect(h.store.occurrence(h.householdId, occurrenceId)!.state).toBe('in_progress');

    // --- 18. Mary reports completion ---------------------------------------
    const completed = await agent
      .post('/api/assistant/turn')
      .set('authorization', voice)
      .send({ text: 'I already ate', occurrenceId, surface: 'voice' });
    expect(completed.body.intent).toBe('report_complete');
    expect(completed.body.action.kind).toBe('complete');

    // --- 19. Every view shows the same final state -------------------------
    const views = await Promise.all(
      [caregiver, tv, voice].map((token) => agent.get('/api/snapshot').set('authorization', token)),
    );
    for (const view of views) {
      const occurrence = view.body.occurrences.find((o: any) => o.id === occurrenceId);
      expect(occurrence.state).toBe('completed_self_report');
      expect(occurrence.confirmedStepIndex).toBe(0);
      expect(view.body.helpRequests[0].status).toBe('acknowledged');
    }

    // Tomorrow's breakfast is still scheduled at the published time.
    const snapshot = h.store.snapshot(h.householdId);
    const future = snapshot.occurrences.filter((o) => o.routineId === routineId && o.localDate > today);
    expect(future.length).toBeGreaterThan(0);
    for (const occurrence of future) {
      expect(occurrence.state).toBe('scheduled');
    }
  });
});
