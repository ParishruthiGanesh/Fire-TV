import type { Db } from './db.js';
import { env } from './env.js';
import { id } from './ids.js';
import { BadRequest, Conflict, NotFound, Store } from './store.js';
import type { EventHub } from './events.js';
import {
  localDateInZone,
  type HelpRequest,
  type HouseholdSnapshot,
  type OccurrenceState,
  type OccurrenceView,
  type Surface,
} from '@alongside/shared';

export interface CommandOptions {
  surface: Surface;
  expectedVersion?: number;
  idempotencyKey?: string;
}

export interface CommandResult {
  occurrence: OccurrenceView;
  snapshot: HouseholdSnapshot;
  /** True when a stored idempotent response was replayed instead of re-applied. */
  replayed: boolean;
}

/**
 * The occurrence state machine.
 *
 * Everything that can change a routine instance goes through here — the
 * dashboard, the TV remote, the voice client and the MCP server all call the
 * same validated methods. Free-form model output never writes to the database;
 * the assistant layer maps an understood intent onto one of these calls.
 */
export class Commands {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly hub: EventHub,
  ) {}

  /** Household time. Everything the caregiver reads is stamped with this. */
  private nowIso(householdId: string): string {
    return this.store.clock.now(householdId).toISOString();
  }

  // --------------------------------------------------------------- occurrence

  start(householdId: string, occurrenceId: string, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'start', opts, (occ) => {
      if (isFinished(occ.state)) {
        throw new BadRequest(`This activity is already marked "${occ.state}".`);
      }
      // Resuming picks up after the last step the person actually confirmed.
      const resumeIndex = Math.min(occ.confirmedStepIndex + 1, Math.max(occ.routine.steps.length - 1, 0));
      this.db
        .prepare(
          `UPDATE occurrences SET state='in_progress', current_step_index=?,
           started_at = COALESCE(started_at, ?), postponed_until=NULL, version = version + 1, updated_at=?
           WHERE id=?`,
        )
        .run(resumeIndex, this.nowIso(householdId), this.nowIso(householdId), occ.id);
      return {
        type: 'occurrence_started',
        summary: `${occ.routine.title} started`,
        detail: { resumedAtStep: resumeIndex, confirmedStepIndex: occ.confirmedStepIndex },
      };
    });
  }

  /**
   * Record that the person confirmed finishing `confirmedStepIndex`.
   *
   * Idempotent by construction: the stored confirmed index only ever moves
   * forward, so a duplicated speech result cannot skip a step or double-count.
   */
  advance(
    householdId: string,
    occurrenceId: string,
    confirmedStepIndex: number,
    opts: CommandOptions,
  ): CommandResult {
    return this.apply(householdId, occurrenceId, 'advance', opts, (occ) => {
      if (isFinished(occ.state)) {
        throw new BadRequest(`This activity is already marked "${occ.state}".`);
      }
      const lastIndex = occ.routine.steps.length - 1;
      if (confirmedStepIndex > lastIndex) {
        throw new BadRequest(`This activity only has ${occ.routine.steps.length} steps.`);
      }
      const confirmed = Math.max(occ.confirmedStepIndex, confirmedStepIndex);
      const allDone = confirmed >= lastIndex;
      const nextIndex = Math.min(confirmed + 1, lastIndex);
      this.db
        .prepare(
          `UPDATE occurrences SET state=?, confirmed_step_index=?, current_step_index=?,
           started_at = COALESCE(started_at, ?), finished_at=?, version = version + 1, updated_at=?
           WHERE id=?`,
        )
        .run(
          allDone ? 'completed_self_report' : 'in_progress',
          confirmed,
          nextIndex,
          this.nowIso(householdId),
          allDone ? this.nowIso(householdId) : null,
          this.nowIso(householdId),
          occ.id,
        );
      return {
        type: allDone ? 'occurrence_completed' : 'step_confirmed',
        summary: allDone
          ? `${occ.routine.title} completed (self-reported)`
          : `${occ.routine.title}: step ${confirmed + 1} confirmed`,
        detail: { confirmedStepIndex: confirmed, nextStepIndex: nextIndex },
      };
    });
  }

  /** Move the display back one step. Never un-confirms anything. */
  back(householdId: string, occurrenceId: string, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'back', opts, (occ) => {
      const nextIndex = Math.max(0, occ.currentStepIndex - 1);
      this.db
        .prepare('UPDATE occurrences SET current_step_index=?, version = version + 1, updated_at=? WHERE id=?')
        .run(nextIndex, this.nowIso(householdId), occ.id);
      return {
        type: 'step_back',
        summary: `${occ.routine.title}: went back to step ${nextIndex + 1}`,
        detail: { currentStepIndex: nextIndex },
      };
    });
  }

  /** Re-present the current step. Deliberately changes no state. */
  repeat(householdId: string, occurrenceId: string, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'repeat', opts, (occ) => ({
      type: 'step_repeated',
      summary: `${occ.routine.title}: repeated step ${occ.currentStepIndex + 1}`,
      detail: { currentStepIndex: occ.currentStepIndex },
      skipVersionBump: true,
    }));
  }

  /**
   * Postpone *this occurrence only*. The recurring routine is untouched, and
   * the new due time is stored as an absolute instant so it survives a
   * restart, a timezone change or a daylight-saving transition.
   */
  postpone(householdId: string, occurrenceId: string, minutes: number, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'postpone', opts, (occ) => {
      if (isFinished(occ.state)) {
        throw new BadRequest(`This activity is already marked "${occ.state}".`);
      }
      const until = new Date(this.store.clock.now(householdId).getTime() + minutes * 60_000).toISOString();
      this.db
        .prepare(
          `UPDATE occurrences SET state='postponed', due_at=?, postponed_until=?, announced_at=NULL,
           postpone_count = postpone_count + 1, version = version + 1, updated_at=? WHERE id=?`,
        )
        .run(until, until, this.nowIso(householdId), occ.id);
      return {
        type: 'occurrence_postponed',
        summary: `${occ.routine.title} postponed by ${minutes} minutes`,
        detail: { minutes, until },
      };
    });
  }

  /** The person said they did it. Recorded as a self-report, never inferred. */
  complete(householdId: string, occurrenceId: string, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'complete', opts, (occ) => {
      if (occ.state === 'completed_self_report') {
        return { type: 'occurrence_completed', summary: `${occ.routine.title} already completed`, skipVersionBump: true };
      }
      this.db
        .prepare(
          `UPDATE occurrences SET state='completed_self_report', finished_at=?, version = version + 1, updated_at=?
           WHERE id=?`,
        )
        .run(this.nowIso(householdId), this.nowIso(householdId), occ.id);
      return {
        type: 'occurrence_completed',
        summary: `${occ.routine.title} completed (self-reported)`,
        detail: { confirmedStepIndex: occ.confirmedStepIndex },
      };
    });
  }

  skip(householdId: string, occurrenceId: string, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'skip', opts, (occ) => {
      this.db
        .prepare(
          `UPDATE occurrences SET state='skipped', finished_at=?, version = version + 1, updated_at=? WHERE id=?`,
        )
        .run(this.nowIso(householdId), this.nowIso(householdId), occ.id);
      return {
        type: 'occurrence_skipped',
        summary: `${occ.routine.title} skipped for today`,
        detail: {},
      };
    });
  }

  /**
   * Set by the scheduler when a due occurrence passes its window untouched.
   * This records only that nobody told us anything — it is not a health signal.
   */
  markUnconfirmed(householdId: string, occurrenceId: string): CommandResult {
    return this.apply(householdId, occurrenceId, 'unconfirmed', { surface: 'system' }, (occ) => {
      this.db
        .prepare(
          `UPDATE occurrences SET state='completion_unconfirmed', version = version + 1, updated_at=? WHERE id=?`,
        )
        .run(this.nowIso(householdId), occ.id);
      return {
        type: 'occurrence_unconfirmed',
        summary: `${occ.routine.title}: no report received`,
        detail: { note: 'No report was received. This is not an alert about the person.' },
      };
    });
  }

  /** Jump the display to a specific step without confirming anything. */
  goToStep(householdId: string, occurrenceId: string, stepIndex: number, opts: CommandOptions): CommandResult {
    return this.apply(householdId, occurrenceId, 'goto', opts, (occ) => {
      const lastIndex = Math.max(occ.routine.steps.length - 1, 0);
      const next = Math.max(0, Math.min(stepIndex, lastIndex));
      this.db
        .prepare('UPDATE occurrences SET current_step_index=?, version = version + 1, updated_at=? WHERE id=?')
        .run(next, this.nowIso(householdId), occ.id);
      return { type: 'step_shown', summary: `${occ.routine.title}: showing step ${next + 1}`, detail: { next } };
    });
  }

  // -------------------------------------------------------------------- help

  /**
   * Create a persistent help request.
   *
   * Help is tracked separately from the occurrence, so a person can ask for a
   * hand while the activity stays in progress. Duplicate suppression works on
   * an explicit idempotency key *and* on a short identical-message window, so
   * a repeated speech result cannot raise two requests.
   */
  createHelpRequest(
    householdId: string,
    input: { occurrenceId: string | null; message: string; surface: Surface; idempotencyKey?: string },
  ): { help: HelpRequest; snapshot: HouseholdSnapshot; replayed: boolean } {
    const stored = this.store.readIdempotent<{ helpId: string }>(householdId, 'help', input.idempotencyKey);
    if (stored) {
      const help = this.store.helpRequest(householdId, stored.helpId);
      if (help) return { help, snapshot: this.store.snapshot(householdId), replayed: true };
    }

    let routineId: string | null = null;
    let stepIndex: number | null = null;
    if (input.occurrenceId) {
      const occ = this.store.occurrenceView(householdId, input.occurrenceId);
      if (!occ) throw new NotFound('occurrence');
      routineId = occ.routineId;
      stepIndex = occ.currentStepIndex;
    }

    // Household time, to match the stamps on the rows we are comparing against.
    const windowStart = new Date(this.store.clock.now(householdId).getTime() - 120_000).toISOString();
    const duplicate = this.db
      .prepare(
        `SELECT id FROM help_requests
         WHERE household_id=? AND status IN ('open','acknowledged') AND message=?
           AND IFNULL(occurrence_id,'') = IFNULL(?, '') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(householdId, input.message, input.occurrenceId, windowStart) as any;
    if (duplicate) {
      this.store.writeIdempotent(householdId, 'help', input.idempotencyKey, { helpId: duplicate.id });
      return {
        help: this.store.helpRequest(householdId, duplicate.id)!,
        snapshot: this.store.snapshot(householdId),
        replayed: true,
      };
    }

    const helpId = id('hr');
    this.db
      .prepare(
        `INSERT INTO help_requests
         (id, household_id, occurrence_id, routine_id, step_index, message, status, raised_from, created_at)
         VALUES (?,?,?,?,?,?,'open',?,?)`,
      )
      .run(helpId, householdId, input.occurrenceId, routineId, stepIndex, input.message, input.surface, this.nowIso(householdId));
    this.store.recordActivity({
      householdId,
      type: 'help_requested',
      summary: `Help requested: "${input.message}"`,
      occurrenceId: input.occurrenceId,
      surface: input.surface,
      detail: { stepIndex },
    });
    this.store.writeIdempotent(householdId, 'help', input.idempotencyKey, { helpId });
    const snapshot = this.store.snapshot(householdId);
    this.hub.publish(householdId, { type: 'snapshot', snapshot });
    return { help: this.store.helpRequest(householdId, helpId)!, snapshot, replayed: false };
  }

  setHelpStatus(
    householdId: string,
    helpId: string,
    status: 'acknowledged' | 'resolved',
  ): { help: HelpRequest; snapshot: HouseholdSnapshot } {
    const existing = this.store.helpRequest(householdId, helpId);
    if (!existing) throw new NotFound('help request');
    const column = status === 'acknowledged' ? 'acknowledged_at' : 'resolved_at';
    this.db
      .prepare(`UPDATE help_requests SET status=?, ${column}=? WHERE id=? AND household_id=?`)
      .run(status, this.nowIso(householdId), helpId, householdId);
    this.store.recordActivity({
      householdId,
      type: `help_${status}`,
      summary: status === 'acknowledged' ? 'Caregiver acknowledged a help request' : 'Help request resolved',
      occurrenceId: existing.occurrenceId,
      surface: 'dashboard',
    });
    const snapshot = this.store.snapshot(householdId);
    this.hub.publish(householdId, { type: 'snapshot', snapshot });
    return { help: this.store.helpRequest(householdId, helpId)!, snapshot };
  }

  // ------------------------------------------------------------------ engine

  private apply(
    householdId: string,
    occurrenceId: string,
    scope: string,
    opts: CommandOptions,
    mutate: (occ: OccurrenceView) => {
      type: string;
      summary: string;
      detail?: Record<string, unknown>;
      skipVersionBump?: boolean;
    },
  ): CommandResult {
    const replay = this.store.readIdempotent<{ occurrenceId: string }>(
      householdId,
      `occ:${scope}`,
      opts.idempotencyKey,
    );
    if (replay) {
      const occurrence = this.store.occurrenceView(householdId, replay.occurrenceId);
      if (occurrence) {
        return { occurrence, snapshot: this.store.snapshot(householdId), replayed: true };
      }
    }

    const occ = this.store.occurrenceView(householdId, occurrenceId);
    if (!occ) throw new NotFound('occurrence');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== occ.version) {
      throw new Conflict(
        'This activity changed somewhere else. Showing the latest version.',
        this.store.snapshot(householdId),
      );
    }

    const outcome = this.db.transaction(() => mutate(occ))();

    this.store.recordActivity({
      householdId,
      type: outcome.type,
      summary: outcome.summary,
      occurrenceId: occ.id,
      surface: opts.surface,
      detail: outcome.detail ?? null,
    });
    this.store.writeIdempotent(householdId, `occ:${scope}`, opts.idempotencyKey, { occurrenceId: occ.id });

    const snapshot = this.store.snapshot(householdId);
    this.hub.publish(householdId, { type: 'snapshot', snapshot });
    return {
      occurrence: this.store.occurrenceView(householdId, occ.id)!,
      snapshot,
      replayed: false,
    };
  }

  /**
   * Occurrences that are due now and not yet announced.
   *
   * Bounded by a grace window: a reminder for 08:00 is not worth announcing at
   * six in the evening, and pretending otherwise would put words on the
   * screen that the moment no longer justifies.
   */
  dueForAnnouncement(householdId: string): OccurrenceView[] {
    const now = this.store.clock.now(householdId);
    const household = this.store.household(householdId);
    const today = localDateInZone(now, household.timezone);
    this.store.materialiseOccurrences(householdId, today, 2);
    const graceStart = new Date(now.getTime() - env.announceGraceMinutes * 60_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT id FROM occurrences
         WHERE household_id=? AND state IN ('scheduled','postponed')
           AND due_at <= ? AND due_at >= ? AND announced_at IS NULL
         ORDER BY due_at ASC`,
      )
      .all(householdId, now.toISOString(), graceStart) as any[];
    return rows
      .map((row) => this.store.occurrenceView(householdId, row.id))
      .filter((o): o is OccurrenceView => Boolean(o));
  }

  markAnnounced(householdId: string, occurrenceId: string): void {
    this.db
      .prepare('UPDATE occurrences SET announced_at=? WHERE id=?')
      .run(this.nowIso(householdId), occurrenceId);
  }

  /**
   * Clear announcements for anything now in the future.
   *
   * Used when the demo clock is moved, so a rehearsed demo can be run again
   * without wiping the database.
   */
  rearmAnnouncements(householdId: string): number {
    const now = this.store.clock.now(householdId).toISOString();
    const result = this.db
      .prepare(
        `UPDATE occurrences SET announced_at = NULL
         WHERE household_id=? AND state IN ('scheduled','postponed') AND due_at > ? AND announced_at IS NOT NULL`,
      )
      .run(householdId, now);
    return result.changes;
  }

  /**
   * Occurrences we announced and then heard nothing about.
   *
   * Staleness is measured from the announcement, not from the scheduled time,
   * so publishing a routine whose time has already passed today does not
   * immediately stamp it "completion unconfirmed" — nobody was ever asked.
   */
  staleOccurrences(householdId: string): OccurrenceView[] {
    const now = this.store.clock.now(householdId);
    const cutoff = new Date(now.getTime() - env.unconfirmedAfterMinutes * 60_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT id FROM occurrences
         WHERE household_id=? AND state IN ('scheduled','postponed')
           AND announced_at IS NOT NULL AND announced_at <= ?`,
      )
      .all(householdId, cutoff) as any[];
    return rows
      .map((row) => this.store.occurrenceView(householdId, row.id))
      .filter((o): o is OccurrenceView => Boolean(o));
  }
}

function isFinished(state: OccurrenceState): boolean {
  return state === 'completed_self_report' || state === 'skipped';
}


