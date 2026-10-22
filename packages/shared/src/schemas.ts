import { z } from 'zod';
import { WEEKDAY_KEYS } from './domain.js';

export const weekdaySchema = z.enum(WEEKDAY_KEYS);

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24-hour local time like "08:30"');

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a local date like "2026-10-22"');

export const draftStepSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  mediaAssetId: z.string().nullable().default(null),
});

export const draftAlternativeSchema = z.object({
  situation: z.string().min(1).max(200),
  response: z.string().min(1).max(600),
  mediaAssetId: z.string().nullable().default(null),
});

export const draftRoutineSchema = z.object({
  title: z.string().min(1).max(120),
  days: z.array(weekdaySchema).min(1),
  localTime: localTimeSchema.nullable(),
  timezone: z.string().min(1),
  instructions: z.string().max(2000).nullable().default(null),
  greeting: z.string().max(400).nullable().default(null),
  steps: z.array(draftStepSchema).max(12).default([]),
  alternatives: z.array(draftAlternativeSchema).max(12).default([]),
  heroMediaAssetId: z.string().nullable().default(null),
  followUpMinutes: z.number().int().min(1).max(240).default(15),
  helpPolicy: z.string().max(600).nullable().default(null),
  oneOff: z
    .object({
      localDate: localDateSchema,
      localTime: localTimeSchema,
      note: z.string().max(200).nullable().default(null),
    })
    .nullable()
    .default(null),
});

export const missingDetailSchema = z.object({
  field: z.string().min(1).max(60),
  question: z.string().min(1).max(300),
});

/**
 * The exact shape the AI provider must return. Anything that fails this schema
 * is rejected and never reaches the database.
 */
export const draftExtractionSchema = z.object({
  routine: draftRoutineSchema,
  missing: z.array(missingDetailSchema).max(8).default([]),
  /** A single short question to put to the caregiver, if anything is missing. */
  followUpQuestion: z.string().max(300).nullable().default(null),
  /** One or two sentences describing what changed, shown in the chat. */
  assistantMessage: z.string().min(1).max(600),
});
export type DraftExtraction = z.infer<typeof draftExtractionSchema>;

export const assistantIntentSchema = z.enum([
  'affirm',
  'decline',
  'ask_question',
  'request_help',
  'postpone',
  'report_complete',
  'next_step',
  'repeat',
  'previous_step',
  'start',
  'something_different',
  'stop',
  'unclear',
]);

/**
 * What the AI is allowed to propose for a runtime turn. Note that it proposes
 * an *intent*, never a database mutation: the server decides which validated
 * action that intent maps to for the current occurrence state.
 */
export const turnUnderstandingSchema = z.object({
  intent: assistantIntentSchema,
  /** Minutes requested, only meaningful for `postpone`. */
  postponeMinutes: z.number().int().min(1).max(240).nullable().default(null),
  /** The person's own words describing a problem, for `something_different`. */
  situation: z.string().max(300).nullable().default(null),
  /** What they asked, for `ask_question`. */
  question: z.string().max(300).nullable().default(null),
  /** 0..1. Below the server threshold we ask a clarifying question instead. */
  confidence: z.number().min(0).max(1).default(0.5),
});
export type TurnUnderstanding = z.infer<typeof turnUnderstandingSchema>;

export const pairRequestSchema = z.object({
  code: z.string().min(4).max(16),
  kind: z.enum(['tv', 'voice']),
  label: z.string().max(80).optional(),
});

export const draftMessageRequestSchema = z.object({
  draftId: z.string().optional(),
  text: z.string().min(1).max(4000),
  mediaAssetIds: z.array(z.string()).max(10).default([]),
  voiceNoteAssetId: z.string().nullable().default(null),
  /** Caregiver explicitly opted in to keeping the raw recording. */
  keepVoiceNote: z.boolean().default(false),
});

export const occurrenceCommandSchema = z.object({
  /** Version the client last saw. Rejected with 409 if the server moved on. */
  expectedVersion: z.number().int().min(0).optional(),
  /** Stable key so a repeated speech result cannot double-apply. */
  idempotencyKey: z.string().min(6).max(120).optional(),
  surface: z.enum(['dashboard', 'tv', 'voice', 'mcp', 'system']).default('dashboard'),
});

export const advanceCommandSchema = occurrenceCommandSchema.extend({
  /** The step the person just confirmed they finished. */
  confirmedStepIndex: z.number().int().min(0).max(50),
});

export const postponeCommandSchema = occurrenceCommandSchema.extend({
  minutes: z.number().int().min(1).max(240).default(15),
});

export const helpRequestCreateSchema = z.object({
  occurrenceId: z.string().nullable().default(null),
  message: z.string().min(1).max(600),
  surface: z.enum(['dashboard', 'tv', 'voice', 'mcp']).default('tv'),
  idempotencyKey: z.string().min(6).max(120).optional(),
});

export const assistantTurnRequestSchema = z.object({
  text: z.string().min(1).max(600),
  occurrenceId: z.string().nullable().default(null),
  surface: z.enum(['voice', 'tv', 'mcp']).default('voice'),
  idempotencyKey: z.string().min(6).max(120).optional(),
});

export const demoClockRequestSchema = z.object({
  action: z.enum(['advance', 'set', 'reset', 'enable', 'disable']),
  /** Minutes to jump forward, for `advance`. */
  minutes: z.number().int().min(-1440).max(1440).optional(),
  /** Absolute local time "HH:MM" to jump to today, for `set`. */
  localTime: localTimeSchema.optional(),
});

export const overrideRequestSchema = z.object({
  routineId: z.string().min(1),
  localDate: localDateSchema,
  localTime: localTimeSchema.nullable().default(null),
  skipped: z.boolean().default(false),
  note: z.string().max(300).nullable().default(null),
});

export const ringSimulateSchema = z.object({
  kind: z.enum(['ding', 'motion']).default('ding'),
  deviceName: z.string().min(1).max(80).default('Front Door'),
  snapshotAssetId: z.string().nullable().default(null),
});
