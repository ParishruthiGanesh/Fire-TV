import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHarness, publishRoutine, setClock, todaysOccurrence, type Harness } from './helpers.js';
import { Store } from '../src/store.js';
import { openDb } from '../src/db.js';

let h: Harness;
afterEach(() => h?.cleanup());

describe('postponing one occurrence', () => {
  it('does not change the recurring routine or any other day', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    h.commands.postpone(h.householdId, occurrence.id, 15, { surface: 'voice' });

    const after = h.store.routine(h.householdId, routine.id)!;
    expect(after.localTime).toBe('08:00');
    expect(after.days).toEqual(routine.days);

    const snapshot = h.store.snapshot(h.householdId);
    const postponed = snapshot.occurrences.find((o) => o.id === occurrence.id)!;
    expect(postponed.state).toBe('postponed');
    expect(new Date(postponed.dueAt).getTime()).toBeGreaterThan(new Date(occurrence.dueAt).getTime());

    const otherDays = snapshot.occurrences.filter((o) => o.routineId === routine.id && o.id !== occurrence.id);
    for (const other of otherDays) {
      expect(other.state).toBe('scheduled');
      expect(new Date(other.dueAt).toISOString().slice(11, 16)).toBe(
        new Date(occurrence.originallyDueAt).toISOString().slice(11, 16),
      );
    }
  });

  it('keeps the new time as an absolute instant that survives a reload', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    const result = h.commands.postpone(h.householdId, occurrence.id, 20, { surface: 'voice' });
    const expected = result.occurrence.dueAt;

    const reopened = new Store(openDb(h.dbFile));
    expect(reopened.occurrence(h.householdId, occurrence.id)!.dueAt).toBe(expected);
  });
});

describe('duplicate requests', () => {
  it('does not double-apply a repeated completion with the same idempotency key', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    const first = h.commands.complete(h.householdId, occurrence.id, { surface: 'voice', idempotencyKey: 'speech-1' });
    const second = h.commands.complete(h.householdId, occurrence.id, { surface: 'voice', idempotencyKey: 'speech-1' });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.occurrence.version).toBe(first.occurrence.version);
    const completions = h.store
      .listActivity(h.householdId)
      .filter((e) => e.type === 'occurrence_completed');
    expect(completions).toHaveLength(1);
  });

  it('confirms a step at most once however many times the same result arrives', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    h.commands.start(h.householdId, occurrence.id, { surface: 'tv' });

    for (let i = 0; i < 3; i += 1) {
      h.commands.advance(h.householdId, occurrence.id, 0, { surface: 'voice', idempotencyKey: 'advance-0' });
    }
    const after = h.store.occurrence(h.householdId, occurrence.id)!;
    expect(after.confirmedStepIndex).toBe(0);
    expect(after.currentStepIndex).toBe(1);
  });

  it('does not create two help requests for the same message', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    const first = h.commands.createHelpRequest(h.householdId, {
      occurrenceId: occurrence.id,
      message: 'I need a hand with the microwave',
      surface: 'voice',
      idempotencyKey: 'help-1',
    });
    const withKey = h.commands.createHelpRequest(h.householdId, {
      occurrenceId: occurrence.id,
      message: 'I need a hand with the microwave',
      surface: 'voice',
      idempotencyKey: 'help-1',
    });
    // Same words again with no key at all — a duplicated speech result.
    const withoutKey = h.commands.createHelpRequest(h.householdId, {
      occurrenceId: occurrence.id,
      message: 'I need a hand with the microwave',
      surface: 'voice',
    });

    expect(withKey.help.id).toBe(first.help.id);
    expect(withoutKey.help.id).toBe(first.help.id);
    expect(h.store.listHelpRequests(h.householdId)).toHaveLength(1);
  });
});

describe('interruption and recovery', () => {
  it('remembers the confirmed step across a reload and resumes after it', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    h.commands.start(h.householdId, occurrence.id, { surface: 'tv' });
    h.commands.advance(h.householdId, occurrence.id, 0, { surface: 'tv' });

    // Simulate the app being closed and reopened against the same database.
    const reopened = new Store(openDb(h.dbFile));
    const restored = reopened.occurrence(h.householdId, occurrence.id)!;
    expect(restored.confirmedStepIndex).toBe(0);
    expect(restored.currentStepIndex).toBe(1);

    // Starting again resumes at the step after the last confirmed one.
    const resumed = h.commands.start(h.householdId, occurrence.id, { surface: 'tv' }).occurrence;
    expect(resumed.currentStepIndex).toBe(1);
    expect(resumed.confirmedStepIndex).toBe(0);
  });

  it('treats showing a step as different from confirming it', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    h.commands.start(h.householdId, occurrence.id, { surface: 'tv' });
    h.commands.goToStep(h.householdId, occurrence.id, 2, { surface: 'tv' });
    h.commands.repeat(h.householdId, occurrence.id, { surface: 'tv' });

    const after = h.store.occurrence(h.householdId, occurrence.id)!;
    expect(after.currentStepIndex).toBe(2);
    expect(after.confirmedStepIndex).toBe(-1);
    expect(after.state).toBe('in_progress');
  });

  it('rejects a stale client that did not see the latest version', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    const staleVersion = occurrence.version;

    h.commands.start(h.householdId, occurrence.id, { surface: 'tv' });

    expect(() =>
      h.commands.postpone(h.householdId, occurrence.id, 15, { surface: 'tv', expectedVersion: staleVersion }),
    ).toThrow(/changed somewhere else/i);
  });
});

describe('declining one occurrence', () => {
  it('leaves the recurring routine active', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    h.commands.skip(h.householdId, occurrence.id, { surface: 'voice' });

    expect(h.store.routine(h.householdId, routine.id)!.active).toBe(true);
    const snapshot = h.store.snapshot(h.householdId);
    expect(snapshot.occurrences.filter((o) => o.routineId === routine.id && o.state === 'scheduled').length).toBeGreaterThan(0);
  });
});

describe('completion is never inferred', () => {
  it('only marks an occurrence unconfirmed after it was actually announced', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    // Well past the window, but nothing has been announced yet.
    setClock(h, '23:30');
    expect(h.commands.staleOccurrences(h.householdId)).toHaveLength(0);
    const occurrence = todaysOccurrence(h, routine.id);
    expect(h.store.occurrence(h.householdId, occurrence.id)!.state).toBe('scheduled');
  });

  it('records a self-report as a self-report, with no step confirmations invented', () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    const after = h.commands.complete(h.householdId, occurrence.id, { surface: 'voice' }).occurrence;
    expect(after.state).toBe('completed_self_report');
    expect(after.confirmedStepIndex).toBe(-1);
  });
});

describe('state changes reach connected clients', () => {
  it('pushes a snapshot over the event stream when an occurrence changes', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    const received: any[] = [];
    const server = h.app.listen(0);
    const port = (server.address() as any).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { authorization: `Bearer ${h.caregiverToken}` },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const readSome = async (count: number) => {
      let buffer = '';
      while (received.length < count) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const chunk of buffer.split('\n\n')) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            try {
              received.push(JSON.parse(line.slice(6)));
            } catch {
              /* partial frame */
            }
          }
        }
        buffer = '';
      }
    };

    await readSome(1);
    expect(received[0].type).toBe('snapshot');

    h.commands.start(h.householdId, occurrence.id, { surface: 'tv' });
    await readSome(2);
    const pushed = received.find((e, i) => i > 0 && e.type === 'snapshot');
    expect(pushed).toBeDefined();
    const pushedOccurrence = pushed.snapshot.occurrences.find((o: any) => o.id === occurrence.id);
    expect(pushedOccurrence.state).toBe('in_progress');

    await reader.cancel().catch(() => {});
    server.close();
  });
});

describe('household access boundaries', () => {
  it('will not let one household read or change another household', async () => {
    h = createHarness();
    const other = createHarness();
    try {
      const { routine } = publishRoutine(other);
      setClock(other, '08:05');
      const theirOccurrence = todaysOccurrence(other, routine.id);

      // Their occurrence id is meaningless in our household.
      expect(h.store.occurrence(h.householdId, theirOccurrence.id)).toBeNull();
      expect(() => h.commands.start(h.householdId, theirOccurrence.id, { surface: 'tv' })).toThrow(/not found/i);

      // And the API agrees, with our token.
      const response = await request(h.app)
        .post(`/api/occurrences/${theirOccurrence.id}/start`)
        .set('authorization', `Bearer ${h.caregiverToken}`)
        .send({});
      expect(response.status).toBe(404);

      // Media cannot be borrowed across households either.
      const theirAsset = other.store.addMediaAsset({
        householdId: other.householdId,
        kind: 'image',
        filename: 'x.png',
        storedName: 'x.png',
        mime: 'image/png',
        bytes: 10,
      });
      expect(() => h.store.assertMediaOwnership(h.householdId, [theirAsset.id])).toThrow(/unknown media asset/i);
    } finally {
      other.cleanup();
    }
  });

  it('rejects an unknown token and refuses caregiver actions to a TV device', async () => {
    h = createHarness();
    const unauthorised = await request(h.app).get('/api/snapshot').set('authorization', 'Bearer nope');
    expect(unauthorised.status).toBe(401);

    const { token } = h.store.pairDevice(h.store.household(h.householdId).pairingCode, 'tv', 'Living room');
    const asDevice = await request(h.app).get('/api/snapshot').set('authorization', `Bearer ${token}`);
    expect(asDevice.status).toBe(200);

    const forbidden = await request(h.app)
      .post('/api/demo-clock')
      .set('authorization', `Bearer ${token}`)
      .send({ action: 'reset' });
    expect(forbidden.status).toBe(403);
  });
});
