import Database from 'better-sqlite3';
import { env, ensureDirs } from './env.js';

export type Db = Database.Database;

let instance: Db | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  pairing_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  access_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  preferred_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en-US',
  photo_asset_id TEXT,
  notes TEXT,
  text_scale REAL NOT NULL DEFAULT 1.0,
  speech_rate REAL NOT NULL DEFAULT 1.0
);

-- A paired TV or voice client. Tokens scope every request to one household.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tv','voice')),
  label TEXT,
  access_token TEXT NOT NULL UNIQUE,
  paired_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','audio','video')),
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  caption TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_drafts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft','published','discarded')),
  routine_json TEXT NOT NULL,
  missing_json TEXT NOT NULL DEFAULT '[]',
  source_turns_json TEXT NOT NULL DEFAULT '[]',
  media_asset_ids_json TEXT NOT NULL DEFAULT '[]',
  voice_note_asset_id TEXT,
  published_routine_id TEXT,
  ai_provider TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  draft_id TEXT,
  title TEXT NOT NULL,
  days_json TEXT NOT NULL,
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  instructions TEXT,
  greeting TEXT,
  hero_media_asset_id TEXT,
  follow_up_minutes INTEGER NOT NULL DEFAULT 15,
  help_policy TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_steps (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  media_asset_id TEXT,
  UNIQUE (routine_id, step_index)
);

CREATE TABLE IF NOT EXISTS routine_alternatives (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  situation TEXT NOT NULL,
  response TEXT NOT NULL,
  media_asset_id TEXT
);

-- One-day changes. These never alter the recurring schedule.
CREATE TABLE IF NOT EXISTS routine_overrides (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  local_time TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (routine_id, local_date)
);

CREATE TABLE IF NOT EXISTS occurrences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  routine_version INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  due_at TEXT NOT NULL,
  originally_due_at TEXT NOT NULL,
  state TEXT NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  confirmed_step_index INTEGER NOT NULL DEFAULT -1,
  postponed_until TEXT,
  postpone_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  announced_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (routine_id, local_date)
);

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  occurrence_id TEXT,
  -- What the assistant last offered, so "yes" and "no" mean something.
  pending_offer TEXT,
  started_at TEXT NOT NULL,
  last_turn_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('assistant','person')),
  text TEXT NOT NULL,
  intent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_requests (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  occurrence_id TEXT,
  routine_id TEXT,
  step_index INTEGER,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')),
  raised_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  occurrence_id TEXT,
  surface TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

-- Replay protection. A repeated speech result reuses the stored response.
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  household_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, scope, key)
);

CREATE TABLE IF NOT EXISTS settings (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  demo_clock_enabled INTEGER NOT NULL DEFAULT 0,
  demo_clock_offset_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ring_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  device_name TEXT NOT NULL,
  source TEXT NOT NULL,
  snapshot_asset_id TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_occ_household_date ON occurrences(household_id, local_date);
CREATE INDEX IF NOT EXISTS idx_help_household ON help_requests(household_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_household ON activity_events(household_id, created_at);
CREATE INDEX IF NOT EXISTS idx_steps_routine ON routine_steps(routine_id, step_index);
`;

export function openDb(dbPath = env.dbPath): Db {
  ensureDirs();
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Db {
  if (!instance) instance = openDb();
  return instance;
}

export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
