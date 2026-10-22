import type { Db } from './db.js';
import type { DemoClockState } from '@alongside/shared';

/**
 * Demo clock.
 *
 * Recording a demo should not mean waiting until 8am, so the household can
 * carry a signed offset applied to every server-side time decision. The offset
 * is persisted (it survives a restart mid-recording) and every surface renders
 * a visible "Demo clock" badge whenever it is non-zero, so a viewer always
 * knows the time on screen is not real time.
 */
export class Clock {
  constructor(private readonly db: Db) {}

  state(householdId: string): DemoClockState {
    const row = this.db
      .prepare('SELECT demo_clock_enabled AS enabled, demo_clock_offset_ms AS offset FROM settings WHERE household_id = ?')
      .get(householdId) as { enabled: number; offset: number } | undefined;
    return {
      enabled: Boolean(row?.enabled),
      offsetMs: row?.offset ?? 0,
      realNow: new Date().toISOString(),
    };
  }

  /** The instant the whole system treats as "now" for this household. */
  now(householdId: string): Date {
    const { enabled, offsetMs } = this.state(householdId);
    return new Date(Date.now() + (enabled ? offsetMs : 0));
  }

  setOffset(householdId: string, offsetMs: number, enabled: boolean): DemoClockState {
    this.db
      .prepare(
        `INSERT INTO settings (household_id, demo_clock_enabled, demo_clock_offset_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(household_id) DO UPDATE SET
           demo_clock_enabled = excluded.demo_clock_enabled,
           demo_clock_offset_ms = excluded.demo_clock_offset_ms`,
      )
      .run(householdId, enabled ? 1 : 0, Math.round(offsetMs));
    return this.state(householdId);
  }

  advance(householdId: string, minutes: number): DemoClockState {
    const current = this.state(householdId);
    return this.setOffset(householdId, current.offsetMs + minutes * 60_000, true);
  }

  reset(householdId: string): DemoClockState {
    return this.setOffset(householdId, 0, false);
  }
}
