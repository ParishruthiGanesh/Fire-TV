import type {
  DraftRoutine,
  MediaAsset,
  OccurrenceView,
  RoutineAlternative,
} from '@alongside/shared';
import type { DraftExtraction, TurnUnderstanding } from '@alongside/shared';

export interface DraftExtractionInput {
  /** The household timezone; the AI must never invent a different one. */
  timezone: string;
  /** Today's local date, so "tomorrow" can be resolved. */
  todayLocalDate: string;
  preferredName: string;
  /** The draft as it stands, or null for a brand-new routine. */
  existing: DraftRoutine | null;
  /** The whole caregiver conversation so far, oldest first. */
  history: Array<{ role: 'caregiver' | 'assistant'; text: string }>;
  /** The newest caregiver message. */
  message: string;
  /** Media the caregiver attached to *this* message. */
  attached: MediaAsset[];
  /** Everything already in the household library, for "use the newer photo". */
  library: MediaAsset[];
}

export interface TurnInput {
  preferredName: string;
  /** Approved context for the activity in play, if any. */
  occurrence: OccurrenceView | null;
  /** The last few turns, oldest first. */
  history: Array<{ role: 'assistant' | 'person'; text: string }>;
  message: string;
}

export interface AlternativeMatchInput {
  situation: string;
  alternatives: RoutineAlternative[];
}

export interface AlternativeMatch {
  /** Index into the supplied alternatives, or null when nothing fits. */
  index: number | null;
  confidence: number;
}

/**
 * Every AI provider implements exactly these three jobs:
 *
 *  1. turn caregiver conversation into a structured draft,
 *  2. classify what the older adult just said,
 *  3. decide which caregiver-approved alternative fits a situation.
 *
 * None of them returns prose that is written to the database or read aloud
 * verbatim without validation — replies are composed from approved text in
 * `assistant.ts`, and drafts are schema-checked before they are stored.
 */
export interface AiProvider {
  readonly name: string;
  /** True when the provider needs no credentials (so the demo always runs). */
  readonly offline: boolean;
  extractDraft(input: DraftExtractionInput): Promise<DraftExtraction>;
  understandTurn(input: TurnInput): Promise<TurnUnderstanding>;
  matchAlternative(input: AlternativeMatchInput): Promise<AlternativeMatch>;
}
