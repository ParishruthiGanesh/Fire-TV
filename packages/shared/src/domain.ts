/**
 * Alongside — shared domain model.
 *
 * Everything in this file is used by the backend, the caregiver web app, the
 * Alexa+ experience simulation and the Fire TV app, so that all four surfaces
 * agree on what a routine, an occurrence and a help request actually are.
 */

/** Days of the week, as stored in routine schedules. */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/**
 * Lifecycle of a single day's instance of a routine.
 *
 * `completion_unconfirmed` is only ever set by the server when a scheduled
 * occurrence passes its window without any report from the person. It means
 * "we do not know", never "something is wrong" — see docs/SAFETY.md.
 */
export type OccurrenceState =
  | 'scheduled'
  | 'in_progress'
  | 'postponed'
  | 'completed_self_report'
  | 'skipped'
  | 'completion_unconfirmed';

export const OCCURRENCE_STATE_LABELS: Record<OccurrenceState, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  postponed: 'Postponed',
  completed_self_report: 'Completed (self-reported)',
  skipped: 'Skipped',
  completion_unconfirmed: 'Completion unconfirmed',
};

export type HelpRequestStatus = 'open' | 'acknowledged' | 'resolved';

export type DraftStatus = 'draft' | 'published' | 'discarded';

export type DeviceKind = 'tv' | 'voice';

export type Surface = 'dashboard' | 'tv' | 'voice' | 'mcp' | 'system';

/** Where a piece of knowledge the assistant uses came from. */
export type Provenance = 'caregiver_approved' | 'user_reported' | 'unknown';

export interface Household {
  id: string;
  name: string;
  timezone: string;
  pairingCode: string;
  createdAt: string;
}

export interface OlderAdultProfile {
  householdId: string;
  preferredName: string;
  fullName: string;
  language: string;
  photoAssetId: string | null;
  notes: string | null;
  textScale: number;
  speechRate: number;
}

export interface Caregiver {
  id: string;
  householdId: string;
  name: string;
  email: string | null;
}

export interface MediaAsset {
  id: string;
  householdId: string;
  kind: 'image' | 'audio' | 'video';
  filename: string;
  mime: string;
  bytes: number;
  caption: string | null;
  isDemo: boolean;
  createdAt: string;
  url: string;
}

export interface RoutineStep {
  id: string;
  index: number;
  title: string;
  /** The approved instruction text. Shown on the TV and read aloud verbatim. */
  body: string;
  mediaAssetId: string | null;
}

/**
 * A caregiver-approved answer to a "something is different" situation.
 * The runtime assistant may only offer alternatives that exist here.
 */
export interface RoutineAlternative {
  id: string;
  /** Short description of the situation, e.g. "oatmeal container missing". */
  situation: string;
  /** Exactly what the assistant is allowed to say. */
  response: string;
  mediaAssetId: string | null;
}

export interface Routine {
  id: string;
  householdId: string;
  title: string;
  days: WeekdayKey[];
  /** Local wall-clock time, "HH:MM" in the household timezone. */
  localTime: string;
  timezone: string;
  /** Free-text context the caregiver supplied (not read aloud verbatim). */
  instructions: string | null;
  steps: RoutineStep[];
  alternatives: RoutineAlternative[];
  heroMediaAssetId: string | null;
  /** Minutes to wait before asking again after "later". */
  followUpMinutes: number;
  /** What the assistant should do when the person asks for help. */
  helpPolicy: string | null;
  /** Opening line the assistant says when the routine comes due. */
  greeting: string | null;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A one-day change that must not alter the recurring schedule. */
export interface RoutineOverride {
  id: string;
  routineId: string;
  /** "YYYY-MM-DD" in the household timezone. */
  localDate: string;
  localTime: string | null;
  skipped: boolean;
  note: string | null;
}

export interface Occurrence {
  id: string;
  householdId: string;
  routineId: string;
  /** Version of the routine this occurrence was materialised from. */
  routineVersion: number;
  localDate: string;
  /** ISO instant the occurrence is due (after any postponement). */
  dueAt: string;
  /** The originally scheduled instant, kept for history. */
  originallyDueAt: string;
  state: OccurrenceState;
  /** Step currently being presented. Presenting is not completing. */
  currentStepIndex: number;
  /**
   * Highest step index the person actually confirmed as done.
   * -1 means "nothing confirmed yet". This is what survives a refresh.
   */
  confirmedStepIndex: number;
  postponedUntil: string | null;
  postponeCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Optimistic-concurrency guard: clients must send the version they saw. */
  version: number;
  updatedAt: string;
}

export interface HelpRequest {
  id: string;
  householdId: string;
  occurrenceId: string | null;
  routineId: string | null;
  routineTitle: string | null;
  stepIndex: number | null;
  stepTitle: string | null;
  message: string;
  status: HelpRequestStatus;
  raisedFrom: Surface;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface ActivityEvent {
  id: string;
  householdId: string;
  type: string;
  summary: string;
  occurrenceId: string | null;
  surface: Surface;
  createdAt: string;
  detail: Record<string, unknown> | null;
}

/** The structured routine proposal the AI produces from a conversation. */
export interface DraftRoutine {
  title: string;
  days: WeekdayKey[];
  localTime: string | null;
  timezone: string;
  instructions: string | null;
  greeting: string | null;
  steps: Array<{ title: string; body: string; mediaAssetId: string | null }>;
  alternatives: Array<{ situation: string; response: string; mediaAssetId: string | null }>;
  heroMediaAssetId: string | null;
  followUpMinutes: number;
  helpPolicy: string | null;
  /**
   * A change the caregiver scoped to a single day ("just for tomorrow").
   * Publishing a draft that carries this leaves the recurring schedule alone
   * and writes a one-day override instead.
   */
  oneOff: { localDate: string; localTime: string; note: string | null } | null;
}

/** A field the AI could not fill in and must not guess. */
export interface MissingDetail {
  field: string;
  question: string;
}

export interface RoutineDraft {
  id: string;
  householdId: string;
  status: DraftStatus;
  routine: DraftRoutine;
  missing: MissingDetail[];
  /** Raw caregiver input, kept for review. */
  sourceTurns: Array<{ role: 'caregiver' | 'assistant'; text: string; createdAt: string }>;
  /** Audio kept only if the caregiver opted in. */
  voiceNoteAssetId: string | null;
  mediaAssetIds: string[];
  publishedRoutineId: string | null;
  /** Which AI provider produced the most recent revision. */
  aiProvider: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  role: 'assistant' | 'person';
  text: string;
  intent: string | null;
  createdAt: string;
}

/** Everything a TV or voice client needs to render the current moment. */
export interface HouseholdSnapshot {
  household: Household;
  profile: OlderAdultProfile;
  /** The caregiver's display name, so every surface can name a real person. */
  caregiverName: string;
  /** Server time, already adjusted by the demo clock if it is running. */
  now: string;
  demoClock: DemoClockState;
  routines: Routine[];
  occurrences: OccurrenceView[];
  helpRequests: HelpRequest[];
  media: MediaAsset[];
  /** The occurrence the TV should foreground right now, if any. */
  focusOccurrenceId: string | null;
}

/** An occurrence joined with the routine revision it was published from. */
export interface OccurrenceView extends Occurrence {
  routine: Routine;
  /** True when dueAt has passed and the occurrence still needs attention. */
  due: boolean;
}

export interface DemoClockState {
  enabled: boolean;
  offsetMs: number;
  /** Real wall-clock instant, for comparison in the UI. */
  realNow: string;
}

/** Validated actions the assistant is allowed to ask the backend to perform. */
export type AssistantAction =
  | { kind: 'start'; occurrenceId: string }
  | { kind: 'advance'; occurrenceId: string; confirmedStepIndex: number }
  | { kind: 'repeat'; occurrenceId: string }
  | { kind: 'back'; occurrenceId: string }
  | { kind: 'postpone'; occurrenceId: string; minutes: number }
  | { kind: 'complete'; occurrenceId: string }
  | { kind: 'skip'; occurrenceId: string }
  | { kind: 'help'; occurrenceId: string | null; message: string }
  | { kind: 'none' };

export type AssistantIntent =
  | 'affirm'
  | 'decline'
  | 'ask_question'
  | 'request_help'
  | 'postpone'
  | 'report_complete'
  | 'next_step'
  | 'repeat'
  | 'previous_step'
  | 'start'
  | 'something_different'
  | 'stop'
  | 'unclear';

/** What the assistant says, plus what it did and where that came from. */
export interface AssistantTurnResult {
  reply: string;
  intent: AssistantIntent;
  action: AssistantAction;
  /** Set when the assistant needs a clarification before changing state. */
  clarification: string | null;
  provenance: Provenance;
  occurrenceId: string | null;
  snapshot: HouseholdSnapshot;
  aiProvider: string;
}

export type ServerEvent =
  | { type: 'snapshot'; snapshot: HouseholdSnapshot }
  | { type: 'occurrence_due'; occurrenceId: string; snapshot: HouseholdSnapshot }
  | { type: 'speak'; occurrenceId: string | null; text: string }
  | { type: 'ring_event'; event: RingVisitorEvent; snapshot: HouseholdSnapshot }
  | { type: 'ping'; now: string };

/**
 * Normalised doorbell event. Only the fields a Ring "ding" event actually
 * carries are modelled here — no identity, no indoor activity, no video.
 */
export interface RingVisitorEvent {
  id: string;
  kind: 'ding' | 'motion';
  deviceName: string;
  receivedAt: string;
  /** Where this event came from. 'simulator' means a local test injection. */
  source: 'simulator';
  snapshotAssetId: string | null;
}
