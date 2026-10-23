import {
  WEEKDAY_KEYS,
  addLocalDays,
  describeDays,
  friendlyTime,
  type DraftRoutine,
  type MediaAsset,
  type MissingDetail,
  type WeekdayKey,
} from '@alongside/shared';
import {
  draftExtractionSchema,
  turnUnderstandingSchema,
  type DraftExtraction,
  type TurnUnderstanding,
} from '@alongside/shared';
import type {
  AiProvider,
  AlternativeMatch,
  AlternativeMatchInput,
  DraftExtractionInput,
  TurnInput,
} from './types.js';

/**
 * Deterministic on-device provider.
 *
 * This is a real rule-based natural-language layer, not a stub: it is what
 * runs when no model credentials are configured, which keeps the whole demo
 * reproducible offline and keeps the hosted providers honest (they must
 * return the same schema this one does). It is deliberately conservative —
 * when it cannot find a detail it reports the detail as missing rather than
 * inventing one.
 */
export class LocalAiProvider implements AiProvider {
  readonly name = 'local-rules';
  readonly offline = true;

  async extractDraft(input: DraftExtractionInput): Promise<DraftExtraction> {
    const text = input.message;
    const lower = text.toLowerCase();
    const base: DraftRoutine =
      input.existing ?? {
        title: '',
        days: [],
        localTime: null,
        timezone: input.timezone,
        instructions: null,
        greeting: null,
        steps: [],
        alternatives: [],
        heroMediaAssetId: null,
        followUpMinutes: 15,
        helpPolicy: null,
        oneOff: null,
      };
    const next: DraftRoutine = {
      ...base,
      timezone: input.timezone,
      steps: [...base.steps],
      alternatives: [...base.alternatives],
    };
    const changes: string[] = [];

    // ---- title
    if (!next.title) {
      next.title = guessTitle(text);
      changes.push(`named it "${next.title}"`);
    }

    // ---- schedule
    const time = parseLocalTime(lower);
    const oneOffDay = detectOneOffDay(lower);
    if (time && oneOffDay) {
      // A change scoped to a single day must not move the recurring schedule.
      const localDate = oneOffDay === 'today' ? input.todayLocalDate : addLocalDays(input.todayLocalDate, 1);
      next.oneOff = { localDate, localTime: time, note: `One-day change requested by the caregiver` };
      changes.push(`set a one-day change for ${oneOffDay} at ${friendlyTime(time)} and left the usual time alone`);
    } else if (time && time !== next.localTime) {
      next.localTime = time;
      changes.push(`set the time to ${friendlyTime(time)}`);
    }

    const days = parseDays(lower);
    if (days && days.length > 0 && days.join() !== next.days.join()) {
      next.days = days;
      changes.push(`set the days to ${describeDays(days).toLowerCase()}`);
    }

    const followUp = parseFollowUpMinutes(lower);
    if (followUp && followUp !== next.followUpMinutes) {
      next.followUpMinutes = followUp;
      changes.push(`set the follow-up to ${followUp} minutes`);
    }

    const helpPolicy = parseHelpPolicy(text);
    if (helpPolicy && helpPolicy !== next.helpPolicy) {
      next.helpPolicy = helpPolicy;
      changes.push('recorded what to do when help is requested');
    }

    // ---- instructions and steps
    const alternatives = parseAlternatives(text);
    for (const alt of alternatives) {
      const existingIndex = next.alternatives.findIndex(
        (a) => normalise(a.situation) === normalise(alt.situation),
      );
      if (existingIndex >= 0) next.alternatives[existingIndex] = { ...alt, mediaAssetId: null };
      else next.alternatives.push({ ...alt, mediaAssetId: null });
    }
    if (alternatives.length > 0) {
      changes.push(`added ${alternatives.length} approved alternative${alternatives.length > 1 ? 's' : ''}`);
    }

    const steps = parseSteps(text);
    if (steps.length > 0) {
      const replacing = /\b(instead|replace|change the steps|new steps)\b/.test(lower) || next.steps.length === 0;
      next.steps = replacing ? steps : [...next.steps, ...steps];
      changes.push(`${replacing && base.steps.length > 0 ? 'replaced' : 'added'} ${steps.length} step${steps.length > 1 ? 's' : ''}`);
    }

    const context = parseContext(text);
    if (context) {
      next.instructions = next.instructions ? `${next.instructions}\n${context}` : context;
    }

    // ---- media
    const mentionsPhoto = /\b(photo|picture|image|snapshot|this one)\b/.test(lower);
    const wantsNewer = /\b(newer|new|instead|replace|different)\b/.test(lower);
    const attachedImages = input.attached.filter((m) => m.kind === 'image');
    if (attachedImages.length > 0) {
      const chosen = attachedImages[attachedImages.length - 1];
      if (!next.heroMediaAssetId || wantsNewer || mentionsPhoto) {
        next.heroMediaAssetId = chosen.id;
        changes.push('linked the photo you attached');
      }
      // Attach any remaining images to steps that have none yet, in order.
      let cursor = 0;
      for (const step of next.steps) {
        if (step.mediaAssetId) continue;
        const image = attachedImages[cursor];
        if (!image) break;
        if (image.id === next.heroMediaAssetId && attachedImages.length > 1) {
          cursor += 1;
          continue;
        }
        step.mediaAssetId = image.id;
        cursor += 1;
      }
    } else if (mentionsPhoto && wantsNewer && input.library.length > 0) {
      const newest = input.library.filter((m) => m.kind === 'image')[0];
      if (newest && newest.id !== next.heroMediaAssetId) {
        next.heroMediaAssetId = newest.id;
        changes.push('switched to the most recent photo in the library');
      }
    }

    // A photo attached before the steps existed still belongs with a step.
    // Match it to the step it describes rather than leaving it only on the
    // title card: "use this photo to show her which one" means *that* one.
    if (next.heroMediaAssetId && next.steps.length > 0 && next.steps.every((s) => !s.mediaAssetId)) {
      const asset = [...input.attached, ...input.library].find((m) => m.id === next.heroMediaAssetId);
      const description = `${asset?.caption ?? ''} ${asset?.filename ?? ''}`;
      const best = bestStepFor(description, next.steps.map((s) => s.body));
      next.steps[best].mediaAssetId = next.heroMediaAssetId;
    }

    if (!next.greeting && next.title) {
      next.greeting = `It's time for ${next.title.toLowerCase()}.`;
    }

    const missing = findMissing(next, input.preferredName, text);
    const followUpQuestion = missing[0]?.question ?? null;

    const summary = changes.length > 0 ? `I ${joinList(changes)}.` : 'I kept the draft as it was.';
    const assistantMessage = followUpQuestion
      ? `${summary} ${followUpQuestion}`
      : `${summary} Have a look at the preview, then publish when it reads right.`;

    return draftExtractionSchema.parse({
      routine: next,
      missing,
      followUpQuestion,
      assistantMessage,
    });
  }

  async understandTurn(input: TurnInput): Promise<TurnUnderstanding> {
    return turnUnderstandingSchema.parse(classifyUtterance(input.message));
  }

  async matchAlternative(input: AlternativeMatchInput): Promise<AlternativeMatch> {
    return scoreAlternatives(input);
  }
}

// --------------------------------------------------------------------- rules

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, 'forty-five': 45,
  sixty: 60, half: 30, quarter: 15,
};

const HOUR_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';

/**
 * Pull a wall-clock time out of free text.
 * Returns "HH:MM" or null. Never guesses when nothing time-like is present.
 */
export function parseLocalTime(lower: string): string | null {
  if (/\b(noon|midday)\b/.test(lower)) return '12:00';
  if (/\bmidnight\b/.test(lower)) return '00:00';

  // "8:30", "08:30 am", "8:30pm"
  const digits = lower.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/);
  if (digits) {
    return applyMeridiem(Number(digits[1]), Number(digits[2]), digits[3], lower);
  }
  // "8 am", "8pm"
  const hourMeridiem = lower.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/);
  if (hourMeridiem) {
    return applyMeridiem(Number(hourMeridiem[1]), 0, hourMeridiem[2], lower);
  }
  // "half past eight", "quarter past eight", "quarter to nine"
  const relative = lower.match(new RegExp(`\\b(half|quarter)\\s+(past|to)\\s+(${HOUR_WORDS}|\\d{1,2})\\b`));
  if (relative) {
    const minutes = relative[1] === 'half' ? 30 : 15;
    const hourValue = NUMBER_WORDS[relative[3]] ?? Number(relative[3]);
    if (relative[2] === 'past') return applyMeridiem(hourValue, minutes, undefined, lower);
    const hour = hourValue - 1 <= 0 ? 12 : hourValue - 1;
    return applyMeridiem(hour, 60 - minutes, undefined, lower);
  }
  // "eight thirty", "eight fifteen", "eight o'clock", "at eight".
  // A duration is never a time: "two minutes" and "for an hour" are excluded,
  // and a bare hour word needs a clock cue ("at", "around", "by") in front.
  const words = lower.match(
    new RegExp(
      `(^|[^a-z])(at|around|by|from)?\\s*(${HOUR_WORDS})\\s*(o'?clock|thirty|fifteen|forty-?five|twenty|oh\\s*\\d)?` +
        `(?!\\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?))`,
    ),
  );
  if (words) {
    const cue = words[2];
    const tail = words[4]?.replace(/\s+/g, '');
    if (cue || tail) {
      const hour = NUMBER_WORDS[words[3]];
      let minutes = 0;
      if (tail && tail !== "o'clock" && tail !== 'oclock') {
        if (tail.startsWith('oh')) minutes = Number(tail.replace('oh', ''));
        else minutes = NUMBER_WORDS[tail.replace('-', '')] ?? NUMBER_WORDS[tail] ?? 0;
      }
      return applyMeridiem(hour, minutes, undefined, lower);
    }
  }
  // Bare "at 8"
  const bare = lower.match(/\bat\s+(\d{1,2})\b(?!\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?))/);
  if (bare) return applyMeridiem(Number(bare[1]), 0, undefined, lower);
  return null;
}

/**
 * Resolve am/pm. An explicit marker always wins. Otherwise we use the
 * surrounding words, and fall back to the convention that 7–11 is morning and
 * 1–6 is afternoon — the ranges where guessing the other way would be absurd.
 */
function applyMeridiem(hour: number, minutes: number, marker: string | undefined, lower: string): string | null {
  if (hour > 23 || minutes > 59) return null;
  let h = hour;
  const isPm = marker ? marker.startsWith('p') : null;
  if (isPm === true) h = hour === 12 ? 12 : hour + 12;
  else if (isPm === false) h = hour === 12 ? 0 : hour;
  else if (hour <= 12) {
    const morning = /\b(morning|breakfast|wake|sunrise|a\.?m\.?)\b/.test(lower);
    const evening = /\b(evening|night|dinner|supper|bed|p\.?m\.?|afternoon|lunch)\b/.test(lower);
    if (morning && !evening) h = hour === 12 ? 0 : hour;
    else if (evening && !morning) h = hour === 12 ? 12 : hour + 12;
    else if (hour >= 7 && hour <= 11) h = hour;
    else if (hour >= 1 && hour <= 6) h = hour + 12;
    else h = hour;
  }
  return `${String(h % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const DAY_ALIASES: Array<[RegExp, WeekdayKey]> = [
  [/\bmon(day)?s?\b/, 'mon'],
  [/\btue(s|sday)?s?\b/, 'tue'],
  [/\bwed(nesday)?s?\b/, 'wed'],
  [/\bthu(r|rs|rsday)?s?\b/, 'thu'],
  [/\bfri(day)?s?\b/, 'fri'],
  [/\bsat(urday)?s?\b/, 'sat'],
  [/\bsun(day)?s?\b/, 'sun'],
];

export function parseDays(lower: string): WeekdayKey[] | null {
  if (/\b(every day|everyday|daily|each day|all week|seven days)\b/.test(lower)) return [...WEEKDAY_KEYS];
  if (/\bweek ?days?\b/.test(lower) && !/\bweekends?\b/.test(lower)) return ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (/\bweekends?\b/.test(lower) && !/\bweek ?days?\b/.test(lower)) return ['sat', 'sun'];
  const found = new Set<WeekdayKey>();
  for (const [pattern, key] of DAY_ALIASES) {
    if (pattern.test(lower)) found.add(key);
  }
  if (found.size === 0) return null;
  return WEEKDAY_KEYS.filter((d) => found.has(d));
}

export function parseFollowUpMinutes(lower: string): number | null {
  const match = lower.match(
    /(?:again|remind|check back|ask)\b[^.?!]*?\bin\s+(?:about\s+)?(\d{1,3}|an|a|five|ten|fifteen|twenty|thirty|forty-five|sixty)\s*(minutes?|mins?|hour)/,
  );
  if (!match) return null;
  const raw = match[1];
  const base = raw === 'an' || raw === 'a' ? 1 : (NUMBER_WORDS[raw] ?? Number(raw));
  if (!Number.isFinite(base) || base <= 0) return null;
  const minutes = match[2].startsWith('hour') ? base * 60 : base;
  return Math.min(240, Math.max(1, Math.round(minutes)));
}

export function parseHelpPolicy(text: string): string | null {
  for (const clause of splitClauses(text)) {
    const lower = clause.toLowerCase();
    if (!/\b(help|stuck|can'?t manage|confused|trouble)\b/.test(lower)) continue;
    if (/\b(call|text|message|ring|phone|let me know|tell me|notify|contact)\b/.test(lower)) {
      return clause.trim();
    }
  }
  return null;
}

/** Only "if <situation>, <what to say>" clauses become approved alternatives. */
export function parseAlternatives(text: string): Array<{ situation: string; response: string; mediaAssetId: null }> {
  const out: Array<{ situation: string; response: string; mediaAssetId: null }> = [];
  for (const clause of splitClauses(text)) {
    const match = clause.match(/^\s*if\s+(.+?)[,;]\s*(.+)$/i);
    if (!match) continue;
    const situation = match[1].trim();
    const response = match[2].trim();
    const lowerSituation = situation.toLowerCase();
    // Follow-up timing and help escalation are handled by their own fields.
    if (/\b(says? later|wants? to wait|asks? for help|needs? help|says? no)\b/.test(lowerSituation)) continue;
    if (situation.length < 3 || response.length < 3) continue;
    out.push({ situation: capitalise(situation), response: sentence(response), mediaAssetId: null });
  }
  return out;
}

const ACTION_VERBS = [
  'take', 'get', 'put', 'open', 'close', 'add', 'pour', 'fill', 'microwave', 'heat', 'warm',
  'stir', 'mix', 'wait', 'press', 'push', 'turn', 'place', 'set', 'bring', 'use', 'check',
  'drink', 'eat', 'swallow', 'wash', 'brush', 'comb', 'dress', 'wear', 'sit', 'walk', 'call',
  'dial', 'answer', 'select', 'cut', 'slice', 'remove', 'cover', 'serve', 'carry', 'hold',
  'scoop', 'measure', 'tap', 'choose', 'pick', 'stand', 'rinse', 'dry', 'button', 'zip',
];

/**
 * Turn instruction prose into ordered steps.
 * Scheduling talk, conditionals and questions are excluded, so "Dad eats
 * breakfast at eight" does not become a step.
 */
export function parseSteps(text: string): Array<{ title: string; body: string; mediaAssetId: null }> {
  const clauses = splitClauses(text, true);
  const steps: Array<{ title: string; body: string; mediaAssetId: null }> = [];
  for (const raw of clauses) {
    const clause = raw.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();
    if (clause.length < 4) continue;
    const lower = clause.toLowerCase();
    if (clause.endsWith('?')) continue;
    if (/^if\b/.test(lower)) continue;
    if (/\b(week ?day|weekend|every day|o'clock|a\.?m\.?|p\.?m\.?|remind|ask again|instead of)\b/.test(lower)) continue;
    if (/^(his|her|their|the)\b.*\bis in\b/.test(lower)) continue; // reference info, not an action
    // Clauses aimed at the assistant about the person ("show him the photo",
    // "remind her to stir") are directions to us, not steps for the person.
    if (/\b(show|tell|ask|remind|let|give|prompt|offer)\s+(him|her|them|mum|mom|dad|grandma|grandpa|my \w+)\b/.test(lower)) continue;
    if (/\b(photo|picture|image)\b/.test(lower) && /\b(use|show|display)\b/.test(lower)) continue;
    const firstWord = lower.split(/\s+/)[0].replace(/[^a-z]/g, '');
    const hasVerb = ACTION_VERBS.includes(firstWord) || ACTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`).test(lower));
    if (!hasVerb) continue;
    if (/\b(ask|tell|show|remind|say)\b/.test(firstWord)) continue; // instructions to the assistant
    steps.push({ title: stepTitle(clause), body: sentence(clause), mediaAssetId: null });
    if (steps.length >= 12) break;
  }
  return steps;
}

/** Reference details worth keeping as context but not read as a step. */
export function parseContext(text: string): string | null {
  const kept = splitClauses(text).filter((clause) => {
    const lower = clause.toLowerCase();
    return /\b(is in|are in|on the|in the)\b/.test(lower) && !/^if\b/.test(lower);
  });
  return kept.length > 0 ? kept.map((c) => sentence(c)).join(' ') : null;
}

export function detectOneOffDay(lower: string): 'today' | 'tomorrow' | null {
  if (/\b(just|only)\b[^.?!]{0,30}\btomorrow\b/.test(lower) || /\btomorrow only\b/.test(lower)) return 'tomorrow';
  if (/\b(just|only)\b[^.?!]{0,30}\btoday\b/.test(lower) || /\btoday only\b/.test(lower)) return 'today';
  if (/\bfor tomorrow only\b/.test(lower)) return 'tomorrow';
  return null;
}

const TITLE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bbreakfast\b/, 'Breakfast'],
  [/\blunch\b/, 'Lunch'],
  [/\b(dinner|supper)\b/, 'Dinner'],
  [/\b(medication|medicine|pills|tablets)\b/, 'Medication'],
  [/\b(getting ready|get ready|shower|dressed|washing up)\b/, 'Getting ready'],
  [/\b(family call|video call|phone call|call with)\b/, 'Family call'],
  [/\b(walk|stroll|exercise|stretches)\b/, 'Walk'],
  [/\b(water|hydration|drink)\b/, 'Drink of water'],
  [/\b(bed|bedtime|night routine)\b/, 'Bedtime'],
];

export function guessTitle(text: string): string {
  const lower = text.toLowerCase();
  for (const [pattern, title] of TITLE_KEYWORDS) {
    if (pattern.test(lower)) return title;
  }
  const words = text.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).slice(0, 4);
  return words.length > 0 ? capitalise(words.join(' ')) : 'New routine';
}

const TRAILING_FILLER = new Set([
  'into', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'out', 'up', 'for', 'and', 'it', 'from',
  'with', 'at', 'then', 'your', 'her', 'his', 'their',
]);

function stepTitle(clause: string): string {
  const words = clause.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).slice(0, 4);
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  return capitalise(words.join(' '));
}

export function findMissing(routine: DraftRoutine, preferredName: string, lastMessage: string): MissingDetail[] {
  const missing: MissingDetail[] = [];
  if (!routine.localTime) {
    missing.push({ field: 'localTime', question: `What time should ${preferredName} do this?` });
  }
  if (routine.days.length === 0) {
    missing.push({ field: 'days', question: 'Which days should this happen on?' });
  }
  if (routine.steps.length === 0) {
    const wantsPreparation = /\b(prepar|cook|make|heat|warm|get ready)\w*\b/i.test(
      `${lastMessage} ${routine.instructions ?? ''}`,
    );
    missing.push({
      field: 'steps',
      question: wantsPreparation
        ? `What preparation instructions should I give ${preferredName}?`
        : `What should I tell ${preferredName} to do, step by step?`,
    });
  }
  return missing;
}

/** Split prose into clauses, optionally also on " then " and " and then ". */
export function splitClauses(text: string, aggressive = false): string[] {
  const normalised = text.replace(/\r/g, '').replace(/\n+/g, '. ');
  let parts = normalised.split(/(?<=[.!?])\s+|;\s*|\n/);
  if (aggressive) {
    parts = parts.flatMap((part) => part.split(/,?\s+(?:and\s+)?then\s+|,\s+(?=(?:take|add|put|stir|press|wait|microwave|get|open|close|pour|fill|heat|warm|set|turn|use|check|drink|eat)\b)/i));
  }
  return parts.map((p) => p.replace(/[.!]+$/, '').trim()).filter((p) => p.length > 0);
}

export function capitalise(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

/**
 * Clause splitting strips terminal punctuation, but these strings are read
 * aloud one after another, so each has to stand as its own sentence.
 */
export function sentence(s: string): string {
  const text = capitalise(s);
  if (!text) return text;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Which step a photo most likely illustrates. Falls back to the first. */
function bestStepFor(description: string, steps: string[]): number {
  const wanted = tokens(description);
  if (wanted.size === 0) return 0;
  let best = 0;
  let bestScore = 0;
  steps.forEach((body, index) => {
    const candidate = tokens(body);
    let overlap = 0;
    for (const word of wanted) if (candidate.has(word)) overlap += 1;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = index;
    }
  });
  return best;
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------- runtime classifier

/**
 * Classify what the older adult said.
 *
 * Order matters: "help me with the next step" is a request for the next
 * instruction, not a request for a person, so the step patterns are checked
 * before the help patterns.
 */
export function classifyUtterance(message: string): TurnUnderstanding {
  const lower = ` ${message.toLowerCase().replace(/[^\w\s'’]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const has = (re: RegExp) => re.test(lower);

  if (has(/\b(stop|be quiet|never mind|nevermind|cancel|forget it)\b/)) {
    return und('stop', { confidence: 0.9 });
  }
  if (has(/\b(next step|the next one|what(?:'s| is)? next|carry on|keep going|go on|move on|continue|what do i do next)\b/)
    || has(/\bhelp me with the next\b/)) {
    return und('next_step', { confidence: 0.85 });
  }
  if (has(/\b(repeat|again please|say (that|it) again|one more time|what did you say|read that again)\b/)) {
    return und('repeat', { confidence: 0.9 });
  }
  if (has(/\b(go back|previous step|back a step|last step again|before that)\b/)) {
    return und('previous_step', { confidence: 0.85 });
  }
  if (has(/\b(already (ate|had it|did it|done|took (it|them)|finished)|i(?:'ve| have)? (eaten|finished|done it)|all done|that(?:'s| is) done|i did it|finished)\b/)) {
    return und('report_complete', { confidence: 0.85 });
  }
  const postpone = lower.match(
    /\b(?:give me|in|after|wait)\s+(?:about\s+)?(\d{1,3}|five|ten|fifteen|twenty|thirty|forty-five|sixty|an|a)\s*(minutes?|mins?|hour)/,
  );
  if (postpone || has(/\b(later|not (?:right )?now|in a (?:bit|while|moment)|hold on|remind me|come back)\b/)) {
    let minutes: number | null = null;
    if (postpone) {
      const raw = postpone[1];
      const base = raw === 'an' || raw === 'a' ? 1 : (NUMBER_WORDS[raw] ?? Number(raw));
      if (Number.isFinite(base) && base > 0) {
        minutes = Math.min(240, postpone[2].startsWith('hour') ? base * 60 : base);
      }
    }
    return und('postpone', { postponeMinutes: minutes, confidence: postpone ? 0.9 : 0.7 });
  }
  if (
    has(/\b(isn'?t there|is not there|not there|can'?t find|cannot find|missing|gone|empty|wrong (photo|picture|one)|isn'?t the photo|is not the photo|different|not what|doesn'?t look|something(?:'s| is)? (?:wrong|different)|out of)\b/)
    || has(/\b(strange|odd|weird|funny|not working|isn'?t working|doesn'?t work|won'?t (?:work|turn|open|close|start|go)|broken|spilled|spilt|ran out|run out|too cold|too hot)\b/)
    // "it is not in the fridge", "they aren't on the shelf" — a location that
    // does not hold what it should is the commonest form of this report.
    || has(/\b(is|are|was|were)? ?(not|n'?t) (in|on|under|next to|by|at|near) (the|my|her|his|their)\b/)
  ) {
    return und('something_different', { situation: message.trim(), confidence: 0.8 });
  }
  if (has(/\b(i need help|help me|need a hand|can you (?:call|get|ask)|call (?:anna|my daughter|my son|someone|for help)|i(?:'m| am) stuck|i can'?t do (?:this|it)|please help)\b/)) {
    return und('request_help', { situation: message.trim(), confidence: 0.9 });
  }
  if (has(/\b(start|let'?s start|begin|show me how|show me where|show me|ready|let'?s go|yes please show)\b/)) {
    return und('start', { confidence: 0.8 });
  }
  if (has(/^\s*(yes|yeah|yep|yup|sure|ok|okay|alright|all right|please do|go ahead|that would be (?:nice|good|lovely)|mm?hm)\b/)) {
    // "Yes. What am I having?" is an acceptance *and* a question; keep both so
    // the assistant can act on the offer and still answer what was asked.
    const trailing = message.replace(/^\s*\W*(yes|yeah|yep|yup|sure|ok(ay)?|alright|all right|please do|go ahead)\b[\s,.!]*/i, '').trim();
    const question = /\b(what|where|which|when|how|why|who)\b/i.test(trailing) || trailing.endsWith('?')
      ? trailing
      : null;
    return und('affirm', { confidence: 0.85, question });
  }
  if (has(/^\s*(no|nope|not really|no thanks|no thank you|i(?:'d| would) rather not)\b/)) {
    return und('decline', { confidence: 0.85 });
  }
  if (has(/\b(what|where|which|when|how|why|who)\b/) || message.trim().endsWith('?')) {
    return und('ask_question', { question: message.trim(), confidence: 0.75 });
  }
  return und('unclear', { confidence: 0.3 });
}

function und(intent: TurnUnderstanding['intent'], extra: Partial<TurnUnderstanding> = {}): TurnUnderstanding {
  return turnUnderstandingSchema.parse({
    intent,
    postponeMinutes: null,
    situation: null,
    question: null,
    confidence: 0.5,
    ...extra,
  });
}

/** Token-overlap match against caregiver-approved alternatives. */
export function scoreAlternatives(input: AlternativeMatchInput): AlternativeMatch {
  const wanted = tokens(input.situation);
  if (wanted.size === 0 || input.alternatives.length === 0) return { index: null, confidence: 0 };
  let best = -1;
  let bestScore = 0;
  input.alternatives.forEach((alt, index) => {
    const candidate = tokens(`${alt.situation} ${alt.response}`);
    let overlap = 0;
    for (const word of wanted) if (candidate.has(word)) overlap += 1;
    // Normalise by the shorter side so a terse report ("the container isn't
    // there") can still match a fuller approved situation.
    const score = overlap / Math.max(2, Math.min(wanted.size, 6));
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  if (bestScore < 0.34 || best < 0) return { index: null, confidence: bestScore };
  return { index: best, confidence: Math.min(1, bestScore) };
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'in', 'on', 'at', 'to', 'of', 'and', 'it', 'my', 'me', 'i',
  'there', 'that', 'this', 'not', 'no', 'isnt', 'cant', 'for', 'with', 'be', 'was', 'his', 'her',
  'but', 'you', 'your', 'we', 'he', 'she', 'they', 'any', 'can', 'do', 'does', 'where', 'what',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}
