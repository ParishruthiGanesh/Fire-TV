import type { Db } from './db.js';
import { env } from './env.js';
import type { Assistant } from './assistant.js';
import type { Commands } from './commands.js';
import type { EventHub } from './events.js';
import type { Store } from './store.js';

/**
 * Server-side scheduling.
 *
 * Due times are decided here, not on the TV or in the voice client, so a
 * reminder does not depend on which screen happens to be awake, and a
 * reconnecting client sees the same world as everyone else. Clients only
 * render what this loop decides.
 *
 * What this deliberately does *not* do: wake a powered-off television,
 * interrupt another app, or speak through a separate Echo device. Reminders
 * surface in the Alongside surfaces that are connected — see docs/SAFETY.md.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly commands: Commands,
    private readonly assistant: Assistant,
    private readonly hub: EventHub,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        console.error('[scheduler] tick failed', error);
      }
    }, env.schedulerIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep. Exposed so tests and the demo clock can drive it directly. */
  tick(): { announced: number; unconfirmed: number } {
    const households = this.db.prepare('SELECT id FROM households').all() as Array<{ id: string }>;
    let announced = 0;
    let unconfirmed = 0;
    for (const { id: householdId } of households) {
      for (const occurrence of this.commands.dueForAnnouncement(householdId)) {
        this.commands.markAnnounced(householdId, occurrence.id);
        const text = this.assistant.composeAnnouncement(householdId, occurrence);
        const snapshot = this.store.snapshot(householdId);
        this.store.recordActivity({
          householdId,
          type: 'occurrence_due',
          summary: `${occurrence.routine.title} is due`,
          occurrenceId: occurrence.id,
          surface: 'system',
        });
        this.hub.publish(householdId, { type: 'occurrence_due', occurrenceId: occurrence.id, snapshot });
        this.hub.publish(householdId, { type: 'speak', occurrenceId: occurrence.id, text });
        announced += 1;
      }
      for (const occurrence of this.commands.staleOccurrences(householdId)) {
        this.commands.markUnconfirmed(householdId, occurrence.id);
        unconfirmed += 1;
      }
    }
    return { announced, unconfirmed };
  }
}
