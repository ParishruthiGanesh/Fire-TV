import { afterEach, describe, expect, it } from 'vitest';
import { classifyUtterance, parseDays, parseFollowUpMinutes, parseLocalTime, parseSteps, parseAlternatives, LocalAiProvider } from '../src/ai/local.js';
import { createHarness, publishRoutine, setClock, todaysOccurrence, type Harness } from './helpers.js';
import { zonedTimeToInstant, localTimeInZone, addLocalDays } from '@alongside/shared';

let h: Harness;
afterEach(() => h?.cleanup());

describe('understanding the caregiver', () => {
  it('reads times without mistaking a duration for a time', () => {
    expect(parseLocalTime('mum eats breakfast at eight on weekdays')).toBe('08:00');
    expect(parseLocalTime('make it eight thirty instead')).toBe('08:30');
    expect(parseLocalTime('heat it in the microwave for two minutes')).toBeNull();
    expect(parseLocalTime('ask again in fifteen minutes')).toBeNull();
    expect(parseLocalTime('she takes it at 9 pm')).toBe('21:00');
    expect(parseLocalTime('half past seven')).toBe('07:30');
    expect(parseLocalTime('at noon')).toBe('12:00');
  });

  it('reads day patterns', () => {
    expect(parseDays('only on weekdays')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(parseDays('every day')).toHaveLength(7);
    expect(parseDays('on saturdays and sundays')).toEqual(['sat', 'sun']);
    expect(parseDays('no schedule mentioned')).toBeNull();
  });

  it('reads the follow-up interval', () => {
    expect(parseFollowUpMinutes('if she says later, ask again in fifteen minutes')).toBe(15);
    expect(parseFollowUpMinutes('remind her in an hour')).toBe(60);
    expect(parseFollowUpMinutes('nothing about follow ups')).toBeNull();
  });

  it('does not turn scheduling talk or directions-to-the-assistant into steps', () => {
    const steps = parseSteps(
      'Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the fridge. ' +
        'Use this photo to show her which one. Ask if she wants preparation help.',
    );
    expect(steps).toHaveLength(0);
  });

  it('turns instruction prose into ordered steps', () => {
    const steps = parseSteps(
      'Take the yellow container out of the fridge. Add milk up to the line, then heat it for two minutes. Give it a stir.',
    );
    // Each step is stored as a complete sentence: they are read aloud one
    // after another, so they cannot run together.
    expect(steps.map((s) => s.body)).toEqual([
      'Take the yellow container out of the fridge.',
      'Add milk up to the line.',
      'Heat it for two minutes.',
      'Give it a stir.',
    ]);
  });

  it('only records an alternative when the caregiver gave both halves', () => {
    const alternatives = parseAlternatives(
      "If the yellow container isn't there, there are packets in the pantry. If she says later, ask again in fifteen minutes.",
    );
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0].situation).toMatch(/yellow container/i);
  });

  it('scopes a one-day change without moving the recurring time', async () => {
    const provider = new LocalAiProvider();
    const result = await provider.extractDraft({
      timezone: 'America/New_York',
      todayLocalDate: '2026-10-22',
      preferredName: 'Mary',
      existing: {
        title: 'Breakfast',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        localTime: '08:00',
        timezone: 'America/New_York',
        instructions: null,
        greeting: null,
        steps: [{ title: 'Eat', body: 'Eat your breakfast.', mediaAssetId: null }],
        alternatives: [],
        heroMediaAssetId: null,
        followUpMinutes: 15,
        helpPolicy: null,
        oneOff: null,
      },
      history: [],
      message: 'Make it nine thirty, but just for tomorrow.',
      attached: [],
      library: [],
    });
    expect(result.routine.localTime).toBe('08:00');
    expect(result.routine.oneOff).toEqual({
      localDate: '2026-10-23',
      localTime: '09:30',
      note: 'One-day change requested by the caregiver',
    });
  });
});

describe('understanding the older adult', () => {
  const cases: Array<[string, string]> = [
    ['Yes, please', 'affirm'],
    ['Yes. What am I having?', 'affirm'],
    ['No thank you', 'decline'],
    ['Help me with the next step', 'next_step'],
    ["What's next?", 'next_step'],
    ['Say that again please', 'repeat'],
    ['Go back a step', 'previous_step'],
    ['Give me fifteen minutes', 'postpone'],
    ['Later', 'postpone'],
    ['I already ate', 'report_complete'],
    ["The container isn't there", 'something_different'],
    ["I can't find my glasses", 'something_different'],
    ["That isn't the photo I expected", 'something_different'],
    ['The kettle is making a strange noise', 'something_different'],
    ['I need help', 'request_help'],
    ['Can you call my daughter', 'request_help'],
    ['Show me how', 'start'],
    ['Where is it?', 'ask_question'],
    ['Stop', 'stop'],
  ];

  for (const [utterance, expected] of cases) {
    it(`classifies "${utterance}" as ${expected}`, () => {
      expect(classifyUtterance(utterance).intent).toBe(expected);
    });
  }

  it('keeps the question when a yes carries one', () => {
    const result = classifyUtterance('Yes. What am I having?');
    expect(result.question).toMatch(/what am i having/i);
  });

  it('reads the number of minutes out of a postponement', () => {
    expect(classifyUtterance('Give me fifteen minutes').postponeMinutes).toBe(15);
    expect(classifyUtterance('in 20 minutes').postponeMinutes).toBe(20);
    expect(classifyUtterance('later').postponeMinutes).toBeNull();
  });

  it('asks for clarification instead of guessing when it cannot tell', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    const before = h.store.occurrence(h.householdId, occurrence.id)!.version;

    const result = await h.assistant.turn(h.householdId, {
      text: 'mmm the thing with the whatsit',
      occurrenceId: occurrence.id,
      surface: 'voice',
    });

    expect(result.intent).toBe('unclear');
    expect(result.clarification).toBeTruthy();
    expect(result.action.kind).toBe('none');
    expect(h.store.occurrence(h.householdId, occurrence.id)!.version).toBe(before);
  });

  it('offers a caregiver-approved alternative when one fits, and admits it when none does', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    const matched = await h.assistant.turn(h.householdId, {
      text: "The container isn't there",
      occurrenceId: occurrence.id,
      surface: 'voice',
    });
    expect(matched.provenance).toBe('caregiver_approved');
    expect(matched.reply).toMatch(/pantry/i);

    const unmatched = await h.assistant.turn(h.householdId, {
      text: 'The kettle is making a strange noise',
      occurrenceId: occurrence.id,
      surface: 'voice',
    });
    expect(unmatched.provenance).toBe('unknown');
    expect(unmatched.reply).toMatch(/don't have a note|don't have that written down/i);
  });

  it('does not duplicate a state change when the same utterance arrives twice', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    await h.assistant.turn(h.householdId, {
      text: 'I need help',
      occurrenceId: occurrence.id,
      surface: 'voice',
      idempotencyKey: 'dup-1',
    });
    await h.assistant.turn(h.householdId, {
      text: 'I need help',
      occurrenceId: occurrence.id,
      surface: 'voice',
      idempotencyKey: 'dup-1',
    });
    expect(h.store.listHelpRequests(h.householdId)).toHaveLength(1);
  });

  it('resolves yes and no against whatever was last offered', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);

    // "something is different" with no matching note offers help; "yes" takes it.
    await h.assistant.turn(h.householdId, {
      text: 'The kettle is making a strange noise',
      occurrenceId: occurrence.id,
      surface: 'voice',
    });
    const accepted = await h.assistant.turn(h.householdId, {
      text: 'Yes please',
      occurrenceId: occurrence.id,
      surface: 'voice',
    });
    expect(accepted.intent).toBe('request_help');
    expect(h.store.listHelpRequests(h.householdId)).toHaveLength(1);
  });
});

describe('household timezone handling', () => {
  it('keeps a local wall-clock time across a daylight-saving change', () => {
    const before = zonedTimeToInstant('2026-03-07', '08:00', 'America/New_York');
    const after = zonedTimeToInstant('2026-03-10', '08:00', 'America/New_York');
    expect(localTimeInZone(before, 'America/New_York')).toBe('08:00');
    expect(localTimeInZone(after, 'America/New_York')).toBe('08:00');
    // The UTC instants differ by an hour across the transition.
    expect(before.toISOString().slice(11, 13)).toBe('13');
    expect(after.toISOString().slice(11, 13)).toBe('12');
  });

  it('materialises each local date exactly once', () => {
    h = createHarness({ timezone: 'Australia/Sydney' });
    const { routine } = publishRoutine(h, {
      title: 'Breakfast',
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      localTime: '08:00',
      timezone: 'Australia/Sydney',
      instructions: null,
      greeting: null,
      steps: [{ title: 'Eat', body: 'Eat breakfast.', mediaAssetId: null }],
      alternatives: [],
      heroMediaAssetId: null,
      followUpMinutes: 15,
      helpPolicy: null,
      oneOff: null,
    });
    h.store.snapshot(h.householdId);
    h.store.snapshot(h.householdId);
    const snapshot = h.store.snapshot(h.householdId);
    const dates = snapshot.occurrences.filter((o) => o.routineId === routine.id).map((o) => o.localDate);
    expect(new Set(dates).size).toBe(dates.length);
    for (const occurrence of snapshot.occurrences) {
      expect(localTimeInZone(occurrence.dueAt, 'Australia/Sydney')).toBe('08:00');
    }
    expect(dates).toContain(addLocalDays(dates[0], 1));
  });
});

describe('a choice made on screen is not speech', () => {
  it('takes a declared intent at face value instead of re-interpreting it', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const occurrence = todaysOccurrence(h, routine.id);
    const approved = routine.alternatives[0];

    // The television sends the caregiver's own wording for the situation the
    // person picked from a list. Put through speech classification it reads as
    // unclear; declared, it reaches the approved answer.
    expect(classifyUtterance(approved.situation).intent).not.toBe('request_help');

    const result = await h.assistant.turn(h.householdId, {
      text: approved.situation,
      occurrenceId: occurrence.id,
      surface: 'tv',
      declaredIntent: 'something_different',
    });

    expect(result.intent).toBe('something_different');
    expect(result.provenance).toBe('caregiver_approved');
    expect(result.reply).toMatch(/pantry/i);
  });

  it('recognises a place that does not hold what it should', () => {
    for (const utterance of [
      'the yellow container is not in the fridge',
      "it isn't on the shelf",
      "they aren't in the cupboard",
    ]) {
      expect(classifyUtterance(utterance).intent).toBe('something_different');
    }
  });
});
