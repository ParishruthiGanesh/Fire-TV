import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../src/db.js';
import { createApp, type AppContext } from '../src/app.js';
import type { DraftRoutine, WeekdayKey } from '@alongside/shared';

export const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const EVERY_DAY: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface Harness extends AppContext {
  dbFile: string;
  householdId: string;
  caregiverToken: string;
  cleanup(): void;
}

let counter = 0;

/** A fresh app with its own SQLite file, so tests cannot see each other. */
export function createHarness(options: { timezone?: string } = {}): Harness {
  counter += 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `alongside-test-${counter}-`));
  const dbFile = path.join(dir, 'test.db');
  const db: Db = openDb(dbFile);
  const ctx = createApp(db);
  const { household } = ctx.store.createHousehold({
    name: 'Test household',
    timezone: options.timezone ?? 'America/New_York',
    caregiverName: 'Anna',
    caregiverToken: `caregiver-${counter}`,
    profile: { preferredName: 'Mary', fullName: 'Mary Whitaker' },
  });
  return {
    ...ctx,
    dbFile,
    householdId: household.id,
    caregiverToken: `caregiver-${counter}`,
    cleanup() {
      ctx.hub.closeAll();
      ctx.scheduler.stop();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function breakfastDraft(timezone = 'America/New_York'): DraftRoutine {
  return {
    title: 'Breakfast',
    days: WEEKDAYS,
    localTime: '08:00',
    timezone,
    instructions: 'The oatmeal is in the yellow container on the middle shelf of the fridge.',
    greeting: "It's breakfast time.",
    steps: [
      { title: 'Take out the container', body: 'Take the yellow container out of the fridge.', mediaAssetId: null },
      { title: 'Add milk and heat', body: 'Add milk up to the line and heat for two minutes.', mediaAssetId: null },
      { title: 'Stir and eat', body: 'Give it a stir and let it stand for a minute.', mediaAssetId: null },
    ],
    alternatives: [
      {
        situation: 'the yellow container is not in the fridge',
        response: 'There are oatmeal packets in the pantry, on the second shelf.',
        mediaAssetId: null,
      },
    ],
    heroMediaAssetId: null,
    followUpMinutes: 15,
    helpPolicy: 'Let me know and I will talk her through it.',
    oneOff: null,
  };
}

/** Publish a routine the short way, for tests about what happens afterwards. */
export function publishRoutine(h: Harness, routine: DraftRoutine = breakfastDraft(), replaceRoutineId?: string) {
  const draft = h.store.createDraft({
    householdId: h.householdId,
    routine,
    missing: [],
    sourceTurns: [],
    mediaAssetIds: [],
    voiceNoteAssetId: null,
    aiProvider: 'test',
  });
  return { draft, routine: h.store.publishDraft(h.householdId, draft.id, replaceRoutineId) };
}

/** Move the household clock to a local time today and sweep the scheduler. */
export function setClock(h: Harness, localTime: string): void {
  const household = h.store.household(h.householdId);
  const real = new Date();
  const [hh, mm] = localTime.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: household.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(real);
  const target = zoned(parts, hh, mm, household.timezone);
  h.store.clock.setOffset(h.householdId, target.getTime() - real.getTime(), true);
}

function zoned(localDate: string, hh: number, mm: number, timeZone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const probe = new Date(guess);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(probe);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const offset = asUtc - Math.floor(probe.getTime() / 1000) * 1000;
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Today's occurrence for a routine, materialising the schedule first. */
export function todaysOccurrence(h: Harness, routineId: string) {
  const snapshot = h.store.snapshot(h.householdId);
  const occurrence = snapshot.occurrences.find(
    (o) => o.routineId === routineId && o.localDate === snapshot.occurrences[0]?.localDate,
  );
  return (
    occurrence ??
    snapshot.occurrences.filter((o) => o.routineId === routineId).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]
  );
}
