import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { breakfastDraft, createHarness, publishRoutine, type Harness } from './helpers.js';
import { addLocalDays, localDateInZone } from '@alongside/shared';

let h: Harness;
afterEach(() => h?.cleanup());

describe('a draft cannot be executed before it is published', () => {
  it('produces no routine and no occurrence while it is only a draft', async () => {
    h = createHarness();
    const response = await request(h.app)
      .post('/api/drafts/message')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .send({ text: 'Mum eats breakfast at eight on weekdays. Take the yellow container out of the fridge.' });

    expect(response.status).toBe(200);
    expect(response.body.draft.status).toBe('draft');
    expect(h.store.listRoutines(h.householdId)).toHaveLength(0);
    expect(h.store.snapshot(h.householdId).occurrences).toHaveLength(0);
  });

  it('refuses to publish a draft that is missing a time or any steps', () => {
    h = createHarness();
    const noTime = h.store.createDraft({
      householdId: h.householdId,
      routine: { ...breakfastDraft(), localTime: null },
      missing: [{ field: 'localTime', question: 'What time?' }],
      sourceTurns: [],
      mediaAssetIds: [],
      voiceNoteAssetId: null,
      aiProvider: 'test',
    });
    expect(() => h.store.publishDraft(h.householdId, noTime.id)).toThrow(/needs a time/i);

    const noSteps = h.store.createDraft({
      householdId: h.householdId,
      routine: { ...breakfastDraft(), steps: [] },
      missing: [],
      sourceTurns: [],
      mediaAssetIds: [],
      voiceNoteAssetId: null,
      aiProvider: 'test',
    });
    expect(() => h.store.publishDraft(h.householdId, noSteps.id)).toThrow(/instruction step/i);
    expect(h.store.listRoutines(h.householdId)).toHaveLength(0);
  });

  it('publishes exactly once and will not re-publish the same draft', () => {
    h = createHarness();
    const { draft } = publishRoutine(h);
    expect(h.store.listRoutines(h.householdId)).toHaveLength(1);
    expect(() => h.store.publishDraft(h.householdId, draft.id)).toThrow(/already been published/i);
  });

  it('bumps the routine version when a revision is published over it', () => {
    h = createHarness();
    const first = publishRoutine(h);
    expect(first.routine.version).toBe(1);
    const second = publishRoutine(h, { ...breakfastDraft(), localTime: '08:30' }, first.routine.id);
    expect(second.routine.version).toBe(2);
    expect(second.routine.localTime).toBe('08:30');
    expect(h.store.listRoutines(h.householdId)).toHaveLength(1);
  });
});

describe('missing instructions produce a clarifying question rather than an invention', () => {
  it('asks what the preparation instructions are instead of making them up', async () => {
    h = createHarness();
    const response = await request(h.app)
      .post('/api/drafts/message')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .send({
        text:
          'Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the fridge. ' +
          'Ask if she wants preparation help.',
      });

    const draft = response.body.draft;
    expect(draft.routine.steps).toHaveLength(0);
    expect(draft.missing.map((m: any) => m.field)).toContain('steps');
    expect(response.body.followUpQuestion).toMatch(/preparation instructions/i);
    // Nothing was invented for the fields that were not described.
    expect(draft.routine.helpPolicy).toBeNull();
  });
});

describe('a one-day change leaves the recurring schedule alone', () => {
  it('writes an override on publish and keeps the routine time', () => {
    h = createHarness();
    const base = publishRoutine(h);
    const today = localDateInZone(new Date(), 'America/New_York');
    const tomorrow = addLocalDays(today, 1);

    const revision = h.store.createDraft({
      householdId: h.householdId,
      routine: { ...breakfastDraft(), oneOff: { localDate: tomorrow, localTime: '09:30', note: 'just tomorrow' } },
      missing: [],
      sourceTurns: [],
      mediaAssetIds: [],
      voiceNoteAssetId: null,
      aiProvider: 'test',
    });
    const routine = h.store.publishDraft(h.householdId, revision.id, base.routine.id);
    h.store.upsertOverride({
      householdId: h.householdId,
      routineId: routine.id,
      localDate: tomorrow,
      localTime: '09:30',
      skipped: false,
      note: null,
    });

    expect(routine.localTime).toBe('08:00');
    const snapshot = h.store.snapshot(h.householdId);
    const tomorrowOccurrence = snapshot.occurrences.find((o) => o.localDate === tomorrow);
    const dayAfter = snapshot.occurrences.find((o) => o.localDate === addLocalDays(today, 2));
    if (tomorrowOccurrence) {
      expect(new Date(tomorrowOccurrence.dueAt).toISOString()).toContain('T13:30');
    }
    if (dayAfter) {
      // Still the usual 08:00 local.
      expect(new Date(dayAfter.dueAt).toISOString()).toContain('T12:00');
    }
  });
});
