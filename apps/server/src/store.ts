import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { env } from './env.js';
import { id, token, pairingCode } from './ids.js';
import { Clock } from './clock.js';
import {
  addLocalDays,
  localDateInZone,
  weekdayOfLocalDate,
  zonedTimeToInstant,
  type ActivityEvent,
  type Caregiver,
  type DraftRoutine,
  type Household,
  type HelpRequest,
  type MediaAsset,
  type MissingDetail,
  type Occurrence,
  type OccurrenceView,
  type OlderAdultProfile,
  type Routine,
  type RoutineAlternative,
  type RoutineDraft,
  type RoutineOverride,
  type RoutineStep,
  type Surface,
  type HouseholdSnapshot,
  type WeekdayKey,
} from '@alongside/shared';

export interface AuthContext {
  householdId: string;
  role: 'caregiver' | 'device';
  deviceKind?: 'tv' | 'voice';
  actorId: string;
}

/** Read/write access to every persisted entity, scoped by household. */
export class Store {
  readonly clock: Clock;

  constructor(readonly db: Db) {
    this.clock = new Clock(db);
  }

  // ---------------------------------------------------------------- household

  createHousehold(input: {
    name: string;
    timezone: string;
    caregiverName: string;
    caregiverEmail?: string | null;
    caregiverToken?: string;
    profile: { preferredName: string; fullName: string; language?: string; notes?: string | null };
  }): { household: Household; caregiver: Caregiver } {
    const now = new Date().toISOString();
    const householdId = id('hh');
    const code = pairingCode();
    this.db
      .prepare('INSERT INTO households (id, name, timezone, pairing_code, created_at) VALUES (?,?,?,?,?)')
      .run(householdId, input.name, input.timezone, code, now);
    const caregiverId = id('cg');
    const accessToken = input.caregiverToken ?? token();
    this.db
      .prepare('INSERT INTO caregivers (id, household_id, name, email, access_token, created_at) VALUES (?,?,?,?,?,?)')
      .run(caregiverId, householdId, input.caregiverName, input.caregiverEmail ?? null, accessToken, now);
    this.db
      .prepare(
        `INSERT INTO profiles (household_id, preferred_name, full_name, language, notes)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        householdId,
        input.profile.preferredName,
        input.profile.fullName,
        input.profile.language ?? 'en-US',
        input.profile.notes ?? null,
      );
    this.db
      .prepare('INSERT INTO settings (household_id, demo_clock_enabled, demo_clock_offset_ms) VALUES (?,0,0)')
      .run(householdId);
    return {
      household: this.household(householdId),
      caregiver: {
        id: caregiverId,
        householdId,
        name: input.caregiverName,
        email: input.caregiverEmail ?? null,
      },
    };
  }

  household(householdId: string): Household {
    const row = this.db
      .prepare('SELECT id, name, timezone, pairing_code, created_at FROM households WHERE id = ?')
      .get(householdId) as any;
    if (!row) throw new NotFound('household');
    return {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      pairingCode: row.pairing_code,
      createdAt: row.created_at,
    };
  }

  firstHousehold(): Household | null {
    const row = this.db.prepare('SELECT id FROM households ORDER BY created_at LIMIT 1').get() as any;
    return row ? this.household(row.id) : null;
  }

  profile(householdId: string): OlderAdultProfile {
    const row = this.db.prepare('SELECT * FROM profiles WHERE household_id = ?').get(householdId) as any;
    if (!row) throw new NotFound('profile');
    return {
      householdId,
      preferredName: row.preferred_name,
      fullName: row.full_name,
      language: row.language,
      photoAssetId: row.photo_asset_id,
      notes: row.notes,
      textScale: row.text_scale,
      speechRate: row.speech_rate,
    };
  }

  updateProfile(householdId: string, patch: Partial<OlderAdultProfile>): OlderAdultProfile {
    const current = this.profile(householdId);
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE profiles SET preferred_name=?, full_name=?, language=?, photo_asset_id=?, notes=?,
         text_scale=?, speech_rate=? WHERE household_id=?`,
      )
      .run(
        next.preferredName,
        next.fullName,
        next.language,
        next.photoAssetId,
        next.notes,
        next.textScale,
        next.speechRate,
        householdId,
      );
    return this.profile(householdId);
  }

  updateHousehold(householdId: string, patch: { name?: string; timezone?: string }): Household {
    const current = this.household(householdId);
    this.db
      .prepare('UPDATE households SET name=?, timezone=? WHERE id=?')
      .run(patch.name ?? current.name, patch.timezone ?? current.timezone, householdId);
    return this.household(householdId);
  }

  // -------------------------------------------------------------------- auth

  authenticate(bearer: string | undefined): AuthContext | null {
    if (!bearer) return null;
    const value = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : bearer.trim();
    if (!value) return null;
    const caregiver = this.db
      .prepare('SELECT id, household_id FROM caregivers WHERE access_token = ?')
      .get(value) as any;
    if (caregiver) {
      return { householdId: caregiver.household_id, role: 'caregiver', actorId: caregiver.id };
    }
    const device = this.db
      .prepare('SELECT id, household_id, kind FROM devices WHERE access_token = ?')
      .get(value) as any;
    if (device) {
      this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), device.id);
      return {
        householdId: device.household_id,
        role: 'device',
        deviceKind: device.kind,
        actorId: device.id,
      };
    }
    return null;
  }

  /** Exchange a pairing code for a device token. Codes are per household. */
  pairDevice(code: string, kind: 'tv' | 'voice', label?: string): { token: string; household: Household } {
    const row = this.db
      .prepare('SELECT id FROM households WHERE pairing_code = ?')
      .get(code.trim().toUpperCase()) as any;
    if (!row) throw new NotFound('pairing code');
    const accessToken = token();
    this.db
      .prepare('INSERT INTO devices (id, household_id, kind, label, access_token, paired_at) VALUES (?,?,?,?,?,?)')
      .run(id('dev'), row.id, kind, label ?? null, accessToken, new Date().toISOString());
    return { token: accessToken, household: this.household(row.id) };
  }

  rotatePairingCode(householdId: string): string {
    const code = pairingCode();
    this.db.prepare('UPDATE households SET pairing_code = ? WHERE id = ?').run(code, householdId);
    return code;
  }

  // ------------------------------------------------------------------- media

  addMediaAsset(input: {
    householdId: string;
    kind: 'image' | 'audio' | 'video';
    filename: string;
    storedName: string;
    mime: string;
    bytes: number;
    caption?: string | null;
    isDemo?: boolean;
  }): MediaAsset {
    const assetId = id('ma');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO media_assets (id, household_id, kind, filename, stored_name, mime, bytes, caption, is_demo, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        assetId,
        input.householdId,
        input.kind,
        input.filename,
        input.storedName,
        input.mime,
        input.bytes,
        input.caption ?? null,
        input.isDemo ? 1 : 0,
        now,
      );
    return this.mediaAsset(input.householdId, assetId)!;
  }

  mediaAsset(householdId: string, assetId: string): MediaAsset | null {
    const row = this.db
      .prepare('SELECT * FROM media_assets WHERE id = ? AND household_id = ?')
      .get(assetId, householdId) as any;
    return row ? mapMedia(row) : null;
  }

  mediaStoredPath(householdId: string, assetId: string): { path: string; mime: string; filename: string } | null {
    const row = this.db
      .prepare('SELECT stored_name, mime, filename FROM media_assets WHERE id = ? AND household_id = ?')
      .get(assetId, householdId) as any;
    if (!row) return null;
    return { path: path.join(env.uploadDir, row.stored_name), mime: row.mime, filename: row.filename };
  }

  listMedia(householdId: string): MediaAsset[] {
    return (
      this.db
        .prepare('SELECT * FROM media_assets WHERE household_id = ? ORDER BY created_at DESC')
        .all(householdId) as any[]
    ).map(mapMedia);
  }

  deleteMediaAsset(householdId: string, assetId: string): boolean {
    const stored = this.mediaStoredPath(householdId, assetId);
    if (!stored) return false;
    this.db.prepare('DELETE FROM media_assets WHERE id = ? AND household_id = ?').run(assetId, householdId);
    try {
      fs.rmSync(stored.path, { force: true });
    } catch {
      /* file already gone */
    }
    return true;
  }

  /** Only asset ids that belong to this household may be referenced. */
  assertMediaOwnership(householdId: string, assetIds: Array<string | null | undefined>): void {
    for (const assetId of assetIds) {
      if (!assetId) continue;
      if (!this.mediaAsset(householdId, assetId)) {
        throw new BadRequest(`Unknown media asset for this household: ${assetId}`);
      }
    }
  }

  // ------------------------------------------------------------------ drafts

  createDraft(input: {
    householdId: string;
    routine: DraftRoutine;
    missing: MissingDetail[];
    sourceTurns: RoutineDraft['sourceTurns'];
    mediaAssetIds: string[];
    voiceNoteAssetId: string | null;
    aiProvider: string;
  }): RoutineDraft {
    const draftId = id('dr');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO routine_drafts
         (id, household_id, status, routine_json, missing_json, source_turns_json, media_asset_ids_json,
          voice_note_asset_id, ai_provider, created_at, updated_at)
         VALUES (?,?,'draft',?,?,?,?,?,?,?,?)`,
      )
      .run(
        draftId,
        input.householdId,
        JSON.stringify(input.routine),
        JSON.stringify(input.missing),
        JSON.stringify(input.sourceTurns),
        JSON.stringify(input.mediaAssetIds),
        input.voiceNoteAssetId,
        input.aiProvider,
        now,
        now,
      );
    return this.draft(input.householdId, draftId)!;
  }

  updateDraft(
    householdId: string,
    draftId: string,
    patch: {
      routine?: DraftRoutine;
      missing?: MissingDetail[];
      sourceTurns?: RoutineDraft['sourceTurns'];
      mediaAssetIds?: string[];
      voiceNoteAssetId?: string | null;
      aiProvider?: string;
      status?: RoutineDraft['status'];
      publishedRoutineId?: string | null;
    },
  ): RoutineDraft {
    const current = this.draft(householdId, draftId);
    if (!current) throw new NotFound('draft');
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE routine_drafts SET status=?, routine_json=?, missing_json=?, source_turns_json=?,
         media_asset_ids_json=?, voice_note_asset_id=?, ai_provider=?, published_routine_id=?, updated_at=?
         WHERE id=? AND household_id=?`,
      )
      .run(
        next.status,
        JSON.stringify(next.routine),
        JSON.stringify(next.missing),
        JSON.stringify(next.sourceTurns),
        JSON.stringify(next.mediaAssetIds),
        next.voiceNoteAssetId,
        next.aiProvider,
        next.publishedRoutineId ?? null,
        new Date().toISOString(),
        draftId,
        householdId,
      );
    return this.draft(householdId, draftId)!;
  }

  draft(householdId: string, draftId: string): RoutineDraft | null {
    const row = this.db
      .prepare('SELECT * FROM routine_drafts WHERE id = ? AND household_id = ?')
      .get(draftId, householdId) as any;
    return row ? mapDraft(row) : null;
  }

  listDrafts(householdId: string, status?: RoutineDraft['status']): RoutineDraft[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM routine_drafts WHERE household_id = ? AND status = ? ORDER BY updated_at DESC')
          .all(householdId, status) as any[])
      : (this.db
          .prepare('SELECT * FROM routine_drafts WHERE household_id = ? ORDER BY updated_at DESC')
          .all(householdId) as any[]);
    return rows.map(mapDraft);
  }

  /** Remove the stored voice note but keep the transcript for review. */
  deleteDraftVoiceNote(householdId: string, draftId: string): RoutineDraft {
    const draft = this.draft(householdId, draftId);
    if (!draft) throw new NotFound('draft');
    if (draft.voiceNoteAssetId) this.deleteMediaAsset(householdId, draft.voiceNoteAssetId);
    return this.updateDraft(householdId, draftId, { voiceNoteAssetId: null });
  }

  // ---------------------------------------------------------------- routines

  /**
   * Turn a reviewed draft into a published routine.
   *
   * Publication is the only path from draft to executable routine, and the
   * only place a routine version is minted. Re-publishing onto an existing
   * routine id bumps its version and leaves already-materialised occurrences
   * pointing at the version they were created from.
   */
  publishDraft(householdId: string, draftId: string, replaceRoutineId?: string): Routine {
    const draft = this.draft(householdId, draftId);
    if (!draft) throw new NotFound('draft');
    if (draft.status === 'published') throw new BadRequest('This draft has already been published.');
    const routine = draft.routine;
    if (!routine.localTime) {
      throw new BadRequest('A routine needs a time before it can be published.');
    }
    if (routine.days.length === 0) {
      throw new BadRequest('A routine needs at least one day before it can be published.');
    }
    if (routine.steps.length === 0) {
      throw new BadRequest('A routine needs at least one instruction step before it can be published.');
    }
    this.assertMediaOwnership(householdId, [
      routine.heroMediaAssetId,
      ...routine.steps.map((s) => s.mediaAssetId),
      ...routine.alternatives.map((a) => a.mediaAssetId),
    ]);

    const now = new Date().toISOString();
    const routineId = replaceRoutineId ?? id('rt');
    const existing = replaceRoutineId ? this.routine(householdId, replaceRoutineId) : null;
    const version = existing ? existing.version + 1 : 1;

    const run = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE routines SET draft_id=?, title=?, days_json=?, local_time=?, timezone=?, instructions=?,
             greeting=?, hero_media_asset_id=?, follow_up_minutes=?, help_policy=?, version=?, active=1, updated_at=?
             WHERE id=? AND household_id=?`,
          )
          .run(
            draftId,
            routine.title,
            JSON.stringify(routine.days),
            routine.localTime,
            routine.timezone,
            routine.instructions,
            routine.greeting,
            routine.heroMediaAssetId,
            routine.followUpMinutes,
            routine.helpPolicy,
            version,
            now,
            routineId,
            householdId,
          );
        this.db.prepare('DELETE FROM routine_steps WHERE routine_id = ?').run(routineId);
        this.db.prepare('DELETE FROM routine_alternatives WHERE routine_id = ?').run(routineId);
      } else {
        this.db
          .prepare(
            `INSERT INTO routines (id, household_id, draft_id, title, days_json, local_time, timezone, instructions,
             greeting, hero_media_asset_id, follow_up_minutes, help_policy, version, active, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          )
          .run(
            routineId,
            householdId,
            draftId,
            routine.title,
            JSON.stringify(routine.days),
            routine.localTime,
            routine.timezone,
            routine.instructions,
            routine.greeting,
            routine.heroMediaAssetId,
            routine.followUpMinutes,
            routine.helpPolicy,
            version,
            now,
            now,
          );
      }
      routine.steps.forEach((step, index) => {
        this.db
          .prepare(
            'INSERT INTO routine_steps (id, routine_id, step_index, title, body, media_asset_id) VALUES (?,?,?,?,?,?)',
          )
          .run(id('st'), routineId, index, step.title, step.body, step.mediaAssetId);
      });
      for (const alt of routine.alternatives) {
        this.db
          .prepare(
            'INSERT INTO routine_alternatives (id, routine_id, situation, response, media_asset_id) VALUES (?,?,?,?,?)',
          )
          .run(id('alt'), routineId, alt.situation, alt.response, alt.mediaAssetId);
      }
      this.db
        .prepare(
          'UPDATE routine_drafts SET status=?, published_routine_id=?, updated_at=? WHERE id=? AND household_id=?',
        )
        .run('published', routineId, now, draftId, householdId);
    });
    run();
    return this.routine(householdId, routineId)!;
  }

  routine(householdId: string, routineId: string): Routine | null {
    const row = this.db
      .prepare('SELECT * FROM routines WHERE id = ? AND household_id = ?')
      .get(routineId, householdId) as any;
    if (!row) return null;
    return this.hydrateRoutine(row);
  }

  listRoutines(householdId: string, includeInactive = false): Routine[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM routines WHERE household_id = ? ${includeInactive ? '' : 'AND active = 1'}
         ORDER BY local_time ASC`,
      )
      .all(householdId) as any[];
    return rows.map((row) => this.hydrateRoutine(row));
  }

  setRoutineActive(householdId: string, routineId: string, active: boolean): Routine {
    this.db
      .prepare('UPDATE routines SET active=?, updated_at=? WHERE id=? AND household_id=?')
      .run(active ? 1 : 0, new Date().toISOString(), routineId, householdId);
    const routine = this.routine(householdId, routineId);
    if (!routine) throw new NotFound('routine');
    return routine;
  }

  private hydrateRoutine(row: any): Routine {
    const steps = (
      this.db
        .prepare('SELECT * FROM routine_steps WHERE routine_id = ? ORDER BY step_index')
        .all(row.id) as any[]
    ).map<RoutineStep>((s) => ({
      id: s.id,
      index: s.step_index,
      title: s.title,
      body: s.body,
      mediaAssetId: s.media_asset_id,
    }));
    const alternatives = (
      this.db.prepare('SELECT * FROM routine_alternatives WHERE routine_id = ?').all(row.id) as any[]
    ).map<RoutineAlternative>((a) => ({
      id: a.id,
      situation: a.situation,
      response: a.response,
      mediaAssetId: a.media_asset_id,
    }));
    return {
      id: row.id,
      householdId: row.household_id,
      title: row.title,
      days: JSON.parse(row.days_json) as WeekdayKey[],
      localTime: row.local_time,
      timezone: row.timezone,
      instructions: row.instructions,
      steps,
      alternatives,
      heroMediaAssetId: row.hero_media_asset_id,
      followUpMinutes: row.follow_up_minutes,
      helpPolicy: row.help_policy,
      greeting: row.greeting,
      version: row.version,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --------------------------------------------------------------- overrides

  upsertOverride(input: {
    householdId: string;
    routineId: string;
    localDate: string;
    localTime: string | null;
    skipped: boolean;
    note: string | null;
  }): RoutineOverride {
    const routine = this.routine(input.householdId, input.routineId);
    if (!routine) throw new NotFound('routine');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO routine_overrides (id, routine_id, local_date, local_time, skipped, note, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(routine_id, local_date) DO UPDATE SET
           local_time = excluded.local_time, skipped = excluded.skipped, note = excluded.note`,
      )
      .run(id('ov'), input.routineId, input.localDate, input.localTime, input.skipped ? 1 : 0, input.note, now);

    // Re-align any already-materialised occurrence for that day.
    const occ = this.db
      .prepare('SELECT id FROM occurrences WHERE routine_id = ? AND local_date = ?')
      .get(input.routineId, input.localDate) as any;
    if (occ) {
      if (input.skipped) {
        this.db
          .prepare(
            `UPDATE occurrences SET state='skipped', version = version + 1, updated_at=? WHERE id=?`,
          )
          .run(now, occ.id);
      } else if (input.localTime) {
        const dueAt = zonedTimeToInstant(input.localDate, input.localTime, routine.timezone).toISOString();
        this.db
          .prepare(
            `UPDATE occurrences SET due_at=?, originally_due_at=?, announced_at=NULL,
             version = version + 1, updated_at=? WHERE id=? AND state IN ('scheduled','postponed')`,
          )
          .run(dueAt, dueAt, now, occ.id);
      }
    }
    return this.override(input.routineId, input.localDate)!;
  }

  override(routineId: string, localDate: string): RoutineOverride | null {
    const row = this.db
      .prepare('SELECT * FROM routine_overrides WHERE routine_id = ? AND local_date = ?')
      .get(routineId, localDate) as any;
    if (!row) return null;
    return {
      id: row.id,
      routineId: row.routine_id,
      localDate: row.local_date,
      localTime: row.local_time,
      skipped: Boolean(row.skipped),
      note: row.note,
    };
  }

  listOverrides(householdId: string): RoutineOverride[] {
    const rows = this.db
      .prepare(
        `SELECT o.* FROM routine_overrides o JOIN routines r ON r.id = o.routine_id
         WHERE r.household_id = ? ORDER BY o.local_date`,
      )
      .all(householdId) as any[];
    return rows.map((row) => ({
      id: row.id,
      routineId: row.routine_id,
      localDate: row.local_date,
      localTime: row.local_time,
      skipped: Boolean(row.skipped),
      note: row.note,
    }));
  }

  // ------------------------------------------------------------- occurrences

  /**
   * Make sure an occurrence row exists for every active routine that is due on
   * each local date in the window. Materialising rather than computing on the
   * fly is what lets progress, postponement and self-reports persist.
   */
  materialiseOccurrences(householdId: string, fromLocalDate: string, days = 3): void {
    const routines = this.listRoutines(householdId);
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO occurrences
       (id, household_id, routine_id, routine_version, local_date, due_at, originally_due_at, state,
        current_step_index, confirmed_step_index, version, updated_at)
       VALUES (?,?,?,?,?,?,?,'scheduled',0,-1,1,?)`,
    );
    const run = this.db.transaction(() => {
      for (let offset = 0; offset < days; offset += 1) {
        const localDate = addLocalDays(fromLocalDate, offset);
        const weekday = weekdayOfLocalDate(localDate);
        for (const routine of routines) {
          if (!routine.days.includes(weekday)) continue;
          const override = this.override(routine.id, localDate);
          if (override?.skipped) continue;
          const localTime = override?.localTime ?? routine.localTime;
          const dueAt = zonedTimeToInstant(localDate, localTime, routine.timezone).toISOString();
          insert.run(
            id('oc'),
            householdId,
            routine.id,
            routine.version,
            localDate,
            dueAt,
            dueAt,
            now,
          );
        }
      }
    });
    run();
  }

  occurrence(householdId: string, occurrenceId: string): Occurrence | null {
    const row = this.db
      .prepare('SELECT * FROM occurrences WHERE id = ? AND household_id = ?')
      .get(occurrenceId, householdId) as any;
    return row ? mapOccurrence(row) : null;
  }

  occurrenceView(householdId: string, occurrenceId: string): OccurrenceView | null {
    const occ = this.occurrence(householdId, occurrenceId);
    if (!occ) return null;
    const routine = this.routine(householdId, occ.routineId);
    if (!routine) return null;
    const now = this.clock.now(householdId);
    return { ...occ, routine, due: new Date(occ.dueAt).getTime() <= now.getTime() };
  }

  listOccurrenceViews(householdId: string, localDates: string[]): OccurrenceView[] {
    if (localDates.length === 0) return [];
    const placeholders = localDates.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM occurrences WHERE household_id = ? AND local_date IN (${placeholders})
         ORDER BY due_at ASC`,
      )
      .all(householdId, ...localDates) as any[];
    const now = this.clock.now(householdId).getTime();
    const views: OccurrenceView[] = [];
    for (const row of rows) {
      const occ = mapOccurrence(row);
      const routine = this.routine(householdId, occ.routineId);
      if (!routine) continue;
      views.push({ ...occ, routine, due: new Date(occ.dueAt).getTime() <= now });
    }
    return views;
  }

  // ------------------------------------------------------------ help & events

  listHelpRequests(householdId: string, limit = 50): HelpRequest[] {
    const rows = this.db
      .prepare(
        `SELECT h.*, r.title AS routine_title FROM help_requests h
         LEFT JOIN routines r ON r.id = h.routine_id
         WHERE h.household_id = ? ORDER BY h.created_at DESC LIMIT ?`,
      )
      .all(householdId, limit) as any[];
    return rows.map((row) => this.mapHelp(row));
  }

  helpRequest(householdId: string, helpId: string): HelpRequest | null {
    const row = this.db
      .prepare(
        `SELECT h.*, r.title AS routine_title FROM help_requests h
         LEFT JOIN routines r ON r.id = h.routine_id
         WHERE h.id = ? AND h.household_id = ?`,
      )
      .get(helpId, householdId) as any;
    return row ? this.mapHelp(row) : null;
  }

  private mapHelp(row: any): HelpRequest {
    let stepTitle: string | null = null;
    if (row.routine_id != null && row.step_index != null) {
      const step = this.db
        .prepare('SELECT title FROM routine_steps WHERE routine_id = ? AND step_index = ?')
        .get(row.routine_id, row.step_index) as any;
      stepTitle = step?.title ?? null;
    }
    return {
      id: row.id,
      householdId: row.household_id,
      occurrenceId: row.occurrence_id,
      routineId: row.routine_id,
      routineTitle: row.routine_title ?? null,
      stepIndex: row.step_index,
      stepTitle,
      message: row.message,
      status: row.status,
      raisedFrom: row.raised_from as Surface,
      createdAt: row.created_at,
      acknowledgedAt: row.acknowledged_at,
      resolvedAt: row.resolved_at,
    };
  }

  recordActivity(input: {
    householdId: string;
    type: string;
    summary: string;
    occurrenceId?: string | null;
    surface: Surface;
    detail?: Record<string, unknown> | null;
  }): ActivityEvent {
    const eventId = id('ev');
    // Household time, not server time: with the demo clock running these have
    // to line up with the times shown on every screen.
    const now = this.clock.now(input.householdId).toISOString();
    this.db
      .prepare(
        `INSERT INTO activity_events (id, household_id, type, summary, occurrence_id, surface, detail_json, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        eventId,
        input.householdId,
        input.type,
        input.summary,
        input.occurrenceId ?? null,
        input.surface,
        input.detail ? JSON.stringify(input.detail) : null,
        now,
      );
    return {
      id: eventId,
      householdId: input.householdId,
      type: input.type,
      summary: input.summary,
      occurrenceId: input.occurrenceId ?? null,
      surface: input.surface,
      createdAt: now,
      detail: input.detail ?? null,
    };
  }

  listActivity(householdId: string, limit = 60): ActivityEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_events WHERE household_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(householdId, limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      type: row.type,
      summary: row.summary,
      occurrenceId: row.occurrence_id,
      surface: row.surface as Surface,
      createdAt: row.created_at,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null,
    }));
  }

  // --------------------------------------------------------------- snapshot

  /**
   * The single payload every surface renders from. Building it in one place is
   * what keeps the TV, the voice client and the dashboard honest with each
   * other: they cannot disagree about state because they read the same object.
   */
  snapshot(householdId: string): HouseholdSnapshot {
    const household = this.household(householdId);
    const now = this.clock.now(householdId);
    const today = localDateInZone(now, household.timezone);
    this.materialiseOccurrences(householdId, today, 3);
    const occurrences = this.listOccurrenceViews(householdId, [
      today,
      addLocalDays(today, 1),
      addLocalDays(today, 2),
    ]);
    const caregiver = this.db
      .prepare('SELECT name FROM caregivers WHERE household_id = ? ORDER BY created_at LIMIT 1')
      .get(householdId) as { name: string } | undefined;
    return {
      household,
      profile: this.profile(householdId),
      caregiverName: caregiver?.name ?? 'your family',
      now: now.toISOString(),
      demoClock: this.clock.state(householdId),
      routines: this.listRoutines(householdId),
      occurrences,
      helpRequests: this.listHelpRequests(householdId),
      media: this.listMedia(householdId),
      focusOccurrenceId: pickFocus(occurrences, now),
    };
  }

  // ----------------------------------------------------------- idempotency

  /** Returns a previously stored response for this key, if there is one. */
  readIdempotent<T>(householdId: string, scope: string, key: string | undefined): T | null {
    if (!key) return null;
    const row = this.db
      .prepare('SELECT response_json FROM idempotency WHERE household_id=? AND scope=? AND key=?')
      .get(householdId, scope, key) as any;
    return row ? (JSON.parse(row.response_json) as T) : null;
  }

  writeIdempotent(householdId: string, scope: string, key: string | undefined, response: unknown): void {
    if (!key) return;
    this.db
      .prepare(
        `INSERT INTO idempotency (key, household_id, scope, response_json, created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(household_id, scope, key) DO NOTHING`,
      )
      .run(key, householdId, scope, JSON.stringify(response), new Date().toISOString());
  }
}

/**
 * Which occurrence the TV should foreground.
 *
 * Preference order: something in progress, then the earliest thing already due
 * and unresolved, then the next thing coming up today.
 */
export function pickFocus(occurrences: OccurrenceView[], now: Date): string | null {
  const nowMs = now.getTime();
  const inProgress = occurrences.find((o) => o.state === 'in_progress');
  if (inProgress) return inProgress.id;
  const pending = occurrences
    .filter((o) => o.state === 'scheduled' || o.state === 'postponed')
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const due = pending.find((o) => new Date(o.dueAt).getTime() <= nowMs);
  if (due) return due.id;
  return pending[0]?.id ?? null;
}

function mapMedia(row: any): MediaAsset {
  return {
    id: row.id,
    householdId: row.household_id,
    kind: row.kind,
    filename: row.filename,
    mime: row.mime,
    bytes: row.bytes,
    caption: row.caption,
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
    url: `/media/${row.id}`,
  };
}

function mapDraft(row: any): RoutineDraft {
  return {
    id: row.id,
    householdId: row.household_id,
    status: row.status,
    routine: JSON.parse(row.routine_json) as DraftRoutine,
    missing: JSON.parse(row.missing_json) as MissingDetail[],
    sourceTurns: JSON.parse(row.source_turns_json),
    mediaAssetIds: JSON.parse(row.media_asset_ids_json),
    voiceNoteAssetId: row.voice_note_asset_id,
    publishedRoutineId: row.published_routine_id,
    aiProvider: row.ai_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOccurrence(row: any): Occurrence {
  return {
    id: row.id,
    householdId: row.household_id,
    routineId: row.routine_id,
    routineVersion: row.routine_version,
    localDate: row.local_date,
    dueAt: row.due_at,
    originallyDueAt: row.originally_due_at,
    state: row.state,
    currentStepIndex: row.current_step_index,
    confirmedStepIndex: row.confirmed_step_index,
    postponedUntil: row.postponed_until,
    postponeCount: row.postpone_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export class NotFound extends Error {
  readonly status = 404;
  constructor(what: string) {
    super(`Not found: ${what}`);
  }
}

export class BadRequest extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
  }
}

export class Conflict extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly current?: unknown,
  ) {
    super(message);
  }
}
