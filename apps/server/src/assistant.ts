import type { Db } from './db.js';
import { id } from './ids.js';
import type { AiService } from './ai/index.js';
import type { Commands } from './commands.js';
import { BadRequest, NotFound, Store } from './store.js';
import type { EventHub } from './events.js';
import {
  greetingForHour,
  spokenTime,
  zonedParts,
  type AssistantAction,
  type AssistantIntent,
  type AssistantTurnResult,
  type OccurrenceView,
  type OlderAdultProfile,
  type Provenance,
  type Surface,
} from '@alongside/shared';

/** What the assistant last offered, so "yes" and "no" have a referent. */
type PendingOffer = 'start' | 'help' | 'postpone' | 'resume' | 'next_step' | null;

export interface TurnRequest {
  text: string;
  occurrenceId: string | null;
  surface: Extract<Surface, 'voice' | 'tv' | 'mcp'>;
  idempotencyKey?: string;
}

/**
 * Runtime conversation orchestration.
 *
 * The model is only ever asked two questions: "what did this person mean?" and
 * "which approved alternative fits?". This class decides what that means for
 * the current occurrence, calls a validated command, and composes the reply
 * from caregiver-approved text. Model prose never becomes a database write and
 * never becomes an instruction read aloud as if a caregiver had approved it.
 */
export class Assistant {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly commands: Commands,
    private readonly ai: AiService,
    private readonly hub: EventHub,
  ) {}

  /** The line said when a routine comes due. */
  composeAnnouncement(householdId: string, occurrence: OccurrenceView): string {
    const profile = this.store.profile(householdId);
    const now = this.store.clock.now(householdId);
    const hour = zonedParts(now, occurrence.routine.timezone).hour;
    const greeting = `${greetingForHour(hour)}, ${profile.preferredName}.`;
    const what = occurrence.routine.greeting ?? `It's time for ${occurrence.routine.title.toLowerCase()}.`;
    const offer =
      occurrence.confirmedStepIndex >= 0
        ? `You were on step ${occurrence.confirmedStepIndex + 2}. Would you like to continue?`
        : occurrence.routine.heroMediaAssetId
          ? 'Would you like me to show you where it is?'
          : 'Would you like me to walk you through it?';
    const text = `${greeting} ${what} ${offer}`;
    this.rememberOffer(householdId, 'voice', occurrence.id, occurrence.confirmedStepIndex >= 0 ? 'resume' : 'start');
    this.rememberOffer(householdId, 'tv', occurrence.id, occurrence.confirmedStepIndex >= 0 ? 'resume' : 'start');
    this.recordTurn(householdId, 'voice', occurrence.id, 'assistant', text, 'announce');
    return text;
  }

  async turn(householdId: string, request: TurnRequest): Promise<AssistantTurnResult> {
    const replay = this.store.readIdempotent<AssistantTurnResult>(
      householdId,
      'assistant:turn',
      request.idempotencyKey,
    );
    if (replay) {
      return { ...replay, snapshot: this.store.snapshot(householdId) };
    }

    const snapshot = this.store.snapshot(householdId);
    const profile = snapshot.profile;
    const occurrenceId = request.occurrenceId ?? snapshot.focusOccurrenceId;
    const occurrence = occurrenceId ? this.store.occurrenceView(householdId, occurrenceId) : null;
    const session = this.session(householdId, request.surface, occurrence?.id ?? null);
    const history = this.recentTurns(session.id, 6);

    this.recordTurn(householdId, request.surface, occurrence?.id ?? null, 'person', request.text, null);

    const understanding = await this.ai.understandTurn({
      preferredName: profile.preferredName,
      occurrence,
      history,
      message: request.text,
    });

    let intent = understanding.intent;
    const pending = session.pendingOffer;

    // Resolve "yes"/"no" against whatever was last offered.
    if (intent === 'affirm') {
      intent =
        pending === 'help'
          ? 'request_help'
          : pending === 'postpone'
            ? 'postpone'
            : pending === 'next_step'
              ? 'next_step'
              : 'start';
    }

    const result = await this.act({
      householdId,
      profile,
      occurrence,
      intent,
      rawIntent: understanding.intent,
      understanding,
      surface: request.surface,
      text: request.text,
      pending,
    });

    this.recordTurn(householdId, request.surface, occurrence?.id ?? null, 'assistant', result.reply, intent);
    this.rememberOffer(householdId, request.surface, occurrence?.id ?? null, result.offer);

    const finalSnapshot = this.store.snapshot(householdId);
    const payload: AssistantTurnResult = {
      reply: result.reply,
      intent: result.intent,
      action: result.action,
      clarification: result.clarification,
      provenance: result.provenance,
      occurrenceId: occurrence?.id ?? null,
      snapshot: finalSnapshot,
      aiProvider: this.ai.name,
    };
    this.store.writeIdempotent(householdId, 'assistant:turn', request.idempotencyKey, {
      ...payload,
      snapshot: undefined as never,
    });
    // Let the TV caption exactly what the assistant said.
    this.hub.publish(householdId, { type: 'speak', occurrenceId: occurrence?.id ?? null, text: result.reply });
    return payload;
  }

  // -------------------------------------------------------------- intent map

  private async act(ctx: {
    householdId: string;
    profile: OlderAdultProfile;
    occurrence: OccurrenceView | null;
    intent: AssistantIntent;
    rawIntent: AssistantIntent;
    understanding: { postponeMinutes: number | null; situation: string | null; question: string | null; confidence: number };
    surface: Extract<Surface, 'voice' | 'tv' | 'mcp'>;
    text: string;
    pending: PendingOffer;
  }): Promise<{
    reply: string;
    intent: AssistantIntent;
    action: AssistantAction;
    clarification: string | null;
    provenance: Provenance;
    offer: PendingOffer;
  }> {
    const { householdId, occurrence, intent, surface, profile } = ctx;
    const opts = { surface } as const;

    // Anything that needs an activity needs an activity.
    const needsOccurrence: AssistantIntent[] = [
      'start', 'next_step', 'repeat', 'previous_step', 'postpone', 'report_complete', 'something_different',
    ];
    if (!occurrence && needsOccurrence.includes(intent)) {
      return {
        reply: `There's nothing on your list right now, ${profile.preferredName}. I'll let you know when there is.`,
        intent,
        action: { kind: 'none' },
        clarification: null,
        provenance: 'unknown',
        offer: null,
      };
    }

    // Low confidence must ask, not guess.
    if (intent === 'unclear' || ctx.understanding.confidence < 0.4) {
      const clarification = occurrence
        ? `Sorry, I didn't quite catch that. Would you like to start ${occurrence.routine.title.toLowerCase()}, or have more time?`
        : "Sorry, I didn't quite catch that. Could you say it again?";
      return {
        reply: clarification,
        intent: 'unclear',
        action: { kind: 'none' },
        clarification,
        provenance: 'unknown',
        offer: 'start',
      };
    }

    switch (intent) {
      case 'start': {
        const occ = occurrence!;
        const resuming = occ.confirmedStepIndex >= 0;
        const after = this.commands.start(householdId, occ.id, opts).occurrence;
        const step = after.routine.steps[after.currentStepIndex];
        const lead = resuming
          ? `Picking up at step ${after.currentStepIndex + 1}.`
          : `Here's the first step.`;
        // Answer what they asked first; the step follows naturally after it.
        const answer = ctx.understanding.question
          ? `${this.answerQuestion(occ, ctx.understanding.question).text} `
          : '';
        return {
          reply: `${answer}${lead} ${step ? step.body : ''}`.trim(),
          intent: 'start',
          action: { kind: 'start', occurrenceId: occ.id },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: 'next_step',
        };
      }

      case 'next_step': {
        const occ = occurrence!;
        // The person asking to move on is the confirmation. Showing or reading
        // a step never confirms it on its own.
        const confirmIndex = occ.state === 'in_progress' ? occ.currentStepIndex : Math.max(occ.confirmedStepIndex, 0);
        const after = this.commands.advance(householdId, occ.id, confirmIndex, opts).occurrence;
        if (after.state === 'completed_self_report') {
          return {
            reply: `That was the last step. I've marked ${after.routine.title.toLowerCase()} as done. Nicely done, ${profile.preferredName}.`,
            intent: 'next_step',
            action: { kind: 'advance', occurrenceId: occ.id, confirmedStepIndex: confirmIndex },
            clarification: null,
            provenance: 'caregiver_approved',
            offer: null,
          };
        }
        const step = after.routine.steps[after.currentStepIndex];
        return {
          reply: `Step ${after.currentStepIndex + 1} of ${after.routine.steps.length}. ${step?.body ?? ''}`.trim(),
          intent: 'next_step',
          action: { kind: 'advance', occurrenceId: occ.id, confirmedStepIndex: confirmIndex },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: 'next_step',
        };
      }

      case 'repeat': {
        const occ = occurrence!;
        const after = this.commands.repeat(householdId, occ.id, opts).occurrence;
        const step = after.routine.steps[after.currentStepIndex];
        return {
          reply: step ? `Step ${after.currentStepIndex + 1}. ${step.body}` : 'There are no steps recorded for this one.',
          intent: 'repeat',
          action: { kind: 'repeat', occurrenceId: occ.id },
          clarification: null,
          provenance: step ? 'caregiver_approved' : 'unknown',
          offer: 'next_step',
        };
      }

      case 'previous_step': {
        const occ = occurrence!;
        const after = this.commands.back(householdId, occ.id, opts).occurrence;
        const step = after.routine.steps[after.currentStepIndex];
        return {
          reply: `Back to step ${after.currentStepIndex + 1}. ${step?.body ?? ''}`.trim(),
          intent: 'previous_step',
          action: { kind: 'back', occurrenceId: occ.id },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: 'next_step',
        };
      }

      case 'postpone': {
        const occ = occurrence!;
        const minutes = ctx.understanding.postponeMinutes ?? occ.routine.followUpMinutes;
        this.commands.postpone(householdId, occ.id, minutes, opts);
        return {
          reply: `Okay. I'll remind you in ${minutes} minutes.`,
          intent: 'postpone',
          action: { kind: 'postpone', occurrenceId: occ.id, minutes },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: null,
        };
      }

      case 'report_complete': {
        const occ = occurrence!;
        this.commands.complete(householdId, occ.id, opts);
        return {
          reply: `Thanks for telling me — I've marked ${occ.routine.title.toLowerCase()} as done.`,
          intent: 'report_complete',
          action: { kind: 'complete', occurrenceId: occ.id },
          clarification: null,
          provenance: 'user_reported',
          offer: null,
        };
      }

      case 'request_help': {
        const message = ctx.understanding.situation ?? ctx.text;
        const { help } = this.commands.createHelpRequest(householdId, {
          occurrenceId: occurrence?.id ?? null,
          message,
          surface,
        });
        const caregiver = this.caregiverName(householdId);
        const policy = occurrence?.routine.helpPolicy;
        return {
          reply:
            `I've put a help request on ${caregiver}'s dashboard with what you're doing right now.` +
            (policy ? ` ${policy}` : '') +
            ` It's there now — nothing has been sent as a message or a call.`,
          intent: 'request_help',
          action: { kind: 'help', occurrenceId: occurrence?.id ?? null, message: help.message },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: null,
        };
      }

      case 'something_different': {
        const occ = occurrence!;
        const situation = ctx.understanding.situation ?? ctx.text;
        const match = await this.ai.matchAlternative({ situation, alternatives: occ.routine.alternatives });
        this.store.recordActivity({
          householdId,
          type: 'something_different',
          summary: `Reported: "${situation}"`,
          occurrenceId: occ.id,
          surface,
          detail: { matchedAlternative: match.index, confidence: match.confidence },
        });
        if (match.index !== null) {
          const alternative = occ.routine.alternatives[match.index];
          if (alternative.mediaAssetId) {
            this.commands.goToStep(householdId, occ.id, occ.currentStepIndex, opts);
          }
          return {
            reply: `${alternative.response} Would you like me to ask ${this.caregiverName(householdId)} for help as well?`,
            intent: 'something_different',
            action: { kind: 'none' },
            clarification: null,
            provenance: 'caregiver_approved',
            offer: 'help',
          };
        }
        return {
          reply:
            `I don't have a note about that, and I can't see the room, so I don't want to guess. ` +
            `Would you like me to ask ${this.caregiverName(householdId)} for help?`,
          intent: 'something_different',
          action: { kind: 'none' },
          clarification: null,
          provenance: 'unknown',
          offer: 'help',
        };
      }

      case 'ask_question': {
        const question = ctx.understanding.question ?? ctx.text;
        if (!occurrence) {
          return {
            reply: "There's nothing on your list right now, so I don't have anything to read out.",
            intent: 'ask_question',
            action: { kind: 'none' },
            clarification: null,
            provenance: 'unknown',
            offer: null,
          };
        }
        const answer = this.answerQuestion(occurrence, question);
        return {
          reply: answer.text,
          intent: 'ask_question',
          action: { kind: 'none' },
          clarification: null,
          provenance: answer.provenance,
          offer: answer.provenance === 'unknown' ? 'help' : 'next_step',
        };
      }

      case 'decline': {
        return {
          reply: occurrence
            ? `That's alright. Say "start" whenever you're ready, or ask me for more time.`
            : "That's alright.",
          intent: 'decline',
          action: { kind: 'none' },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: 'start',
        };
      }

      case 'stop': {
        return {
          reply: 'Alright, I\'ll stop there.',
          intent: 'stop',
          action: { kind: 'none' },
          clarification: null,
          provenance: 'caregiver_approved',
          offer: null,
        };
      }

      default: {
        return {
          reply: "Sorry, I didn't catch that.",
          intent: 'unclear',
          action: { kind: 'none' },
          clarification: "Sorry, I didn't catch that.",
          provenance: 'unknown',
          offer: null,
        };
      }
    }
  }

  // ------------------------------------------------------- grounded answers

  /**
   * Answer a question using only what the caregiver published.
   *
   * There is no fallback to general knowledge: if the answer is not in the
   * approved steps, context or alternatives, the assistant says so. That is
   * the whole point — a confident guess about where someone's medication is
   * kept is worse than "I don't have that written down".
   */
  answerQuestion(occurrence: OccurrenceView, question: string): { text: string; provenance: Provenance } {
    const routine = occurrence.routine;
    const lower = question.toLowerCase();
    const sentences = [
      ...(routine.instructions ? splitSentences(routine.instructions) : []),
      ...routine.steps.map((s) => s.body),
      ...routine.alternatives.map((a) => a.response),
    ];

    // A question has to be *about this activity* before approved text is a
    // valid answer. "What is the wifi password?" must not be answered with the
    // first sentence of the breakfast instructions.
    const vocabulary = wordSet([routine.title, routine.instructions ?? '', ...sentences].join(' '));
    const asked = wordSet(question);
    const overlapsActivity = [...asked].some((word) => vocabulary.has(word));
    const referential = asked.size === 0 || (asked.size <= 2 && /\b(it|this|that|one|them|here|mine)\b/.test(lower));
    if (!overlapsActivity && !referential) {
      return { text: this.cannotAnswer(occurrence), provenance: 'unknown' };
    }

    if (/\bwhen\b|\bwhat time\b/.test(lower)) {
      return {
        text: `${routine.title} is at ${spokenTime(routine.localTime)}.`,
        provenance: 'caregiver_approved',
      };
    }
    if (/\bhow many steps\b|\bhow long\b|\bhow much longer\b/.test(lower)) {
      return {
        text: `There are ${routine.steps.length} steps, and you're on step ${occurrence.currentStepIndex + 1}.`,
        provenance: 'caregiver_approved',
      };
    }
    if (/\bwhere\b/.test(lower)) {
      const located = sentences.find((s) => LOCATION_RE.test(s));
      if (located) return { text: located, provenance: 'caregiver_approved' };
    }
    if (/\b(what|which)\b/.test(lower)) {
      // "What am I having?" — the caregiver's reference context answers this.
      const context = routine.instructions ? splitSentences(routine.instructions)[0] : null;
      if (context) return { text: context, provenance: 'caregiver_approved' };
    }
    if (/\bhow\b/.test(lower)) {
      const step = routine.steps[occurrence.currentStepIndex];
      if (step) return { text: step.body, provenance: 'caregiver_approved' };
    }

    const scored = sentences
      .map((sentence) => ({ sentence, score: overlap(question, sentence) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score >= 0.3) {
      return { text: scored[0].sentence, provenance: 'caregiver_approved' };
    }
    return { text: this.cannotAnswer(occurrence), provenance: 'unknown' };
  }

  /** The one sentence the assistant says when the answer simply is not there. */
  private cannotAnswer(occurrence: OccurrenceView): string {
    return (
      `I don't have that written down for ${occurrence.routine.title.toLowerCase()}. ` +
      `I can ask ${this.caregiverName(occurrence.householdId)} for you, if you'd like.`
    );
  }

  // -------------------------------------------------------------- plumbing

  private caregiverName(householdId: string): string {
    const row = this.db
      .prepare('SELECT name FROM caregivers WHERE household_id = ? ORDER BY created_at LIMIT 1')
      .get(householdId) as any;
    return row?.name ?? 'your family';
  }

  private session(
    householdId: string,
    surface: string,
    occurrenceId: string | null,
  ): { id: string; pendingOffer: PendingOffer } {
    const existing = this.db
      .prepare(
        `SELECT id, pending_offer FROM conversation_sessions
         WHERE household_id=? AND surface=? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(householdId, surface) as any;
    if (existing) {
      return { id: existing.id, pendingOffer: (existing.pending_offer as PendingOffer) ?? null };
    }
    const sessionId = id('cs');
    this.db
      .prepare(
        'INSERT INTO conversation_sessions (id, household_id, surface, occurrence_id, started_at) VALUES (?,?,?,?,?)',
      )
      .run(sessionId, householdId, surface, occurrenceId, new Date().toISOString());
    return { id: sessionId, pendingOffer: null };
  }

  private rememberOffer(
    householdId: string,
    surface: string,
    occurrenceId: string | null,
    offer: PendingOffer,
  ): void {
    const session = this.session(householdId, surface, occurrenceId);
    this.db
      .prepare('UPDATE conversation_sessions SET pending_offer=?, occurrence_id=?, last_turn_at=? WHERE id=?')
      .run(offer, occurrenceId, new Date().toISOString(), session.id);
  }

  private recordTurn(
    householdId: string,
    surface: string,
    occurrenceId: string | null,
    role: 'assistant' | 'person',
    text: string,
    intent: string | null,
  ): void {
    const session = this.session(householdId, surface, occurrenceId);
    this.db
      .prepare('INSERT INTO conversation_turns (id, session_id, role, text, intent, created_at) VALUES (?,?,?,?,?,?)')
      .run(id('ct'), session.id, role, text, intent, new Date().toISOString());
  }

  recentTurns(sessionId: string, limit: number): Array<{ role: 'assistant' | 'person'; text: string }> {
    const rows = this.db
      .prepare('SELECT role, text FROM conversation_turns WHERE session_id=? ORDER BY created_at DESC LIMIT ?')
      .all(sessionId, limit) as any[];
    return rows.reverse().map((r) => ({ role: r.role, text: r.text }));
  }

  transcript(householdId: string, surface: string, limit = 40): Array<{ role: string; text: string; createdAt: string }> {
    const rows = this.db
      .prepare(
        `SELECT t.role, t.text, t.created_at FROM conversation_turns t
         JOIN conversation_sessions s ON s.id = t.session_id
         WHERE s.household_id=? AND s.surface=? ORDER BY t.created_at DESC LIMIT ?`,
      )
      .all(householdId, surface, limit) as any[];
    return rows.reverse().map((r) => ({ role: r.role, text: r.text, createdAt: r.created_at }));
  }
}

const LOCATION_RE =
  /\b(in the|on the|next to|inside|under|above|behind|fridge|refrigerator|freezer|cupboard|cabinet|pantry|shelf|drawer|counter|table|bathroom|bedroom|kitchen|hallway|windowsill|basket)\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function overlap(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  if (left.size === 0) return 0;
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / Math.max(2, Math.min(left.size, 6));
}

const SMALL_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'am', 'do', 'does', 'did', 'i', 'my', 'me', 'it', 'in', 'on',
  'at', 'to', 'of', 'and', 'what', 'where', 'which', 'how', 'when', 'for', 'with', 'this', 'that',
  'you', 'your', 'have', 'having', 'be', 'can', 'should', 'would', 'will',
]);

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !SMALL_WORDS.has(w)),
  );
}

export { BadRequest, NotFound };
