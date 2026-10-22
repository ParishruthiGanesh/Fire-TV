import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env, ensureDirs } from './env.js';
import { getDb, type Db } from './db.js';
import { id } from './ids.js';
import { BadRequest, Conflict, NotFound, Store, type AuthContext } from './store.js';
import { Commands } from './commands.js';
import { EventHub } from './events.js';
import { Assistant } from './assistant.js';
import { Scheduler } from './scheduler.js';
import { createAiProvider, type AiService } from './ai/index.js';
import { createMcpRouter } from './mcp.js';
import {
  advanceCommandSchema,
  assistantTurnRequestSchema,
  demoClockRequestSchema,
  draftMessageRequestSchema,
  helpRequestCreateSchema,
  localDateInZone,
  occurrenceCommandSchema,
  overrideRequestSchema,
  pairRequestSchema,
  postponeCommandSchema,
  ringSimulateSchema,
  zonedTimeToInstant,
  type RingVisitorEvent,
} from '@alongside/shared';

export interface AppContext {
  app: express.Express;
  db: Db;
  store: Store;
  commands: Commands;
  assistant: Assistant;
  scheduler: Scheduler;
  hub: EventHub;
  ai: AiService;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function createApp(db: Db = getDb()): AppContext {
  ensureDirs();
  const store = new Store(db);
  const hub = new EventHub();
  const commands = new Commands(db, store, hub);
  const ai = createAiProvider();
  const assistant = new Assistant(db, store, commands, ai, hub);
  const scheduler = new Scheduler(db, store, commands, assistant, hub);

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, env.uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
        cb(null, `${id('file')}${ext}`);
      },
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (/^(image|audio|video)\//.test(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new BadRequest(`Unsupported file type: ${file.mimetype}`));
    },
  });

  // --------------------------------------------------------------------- auth

  /**
   * Bearer token in the header, or `?token=` for the two cases a browser
   * cannot send headers at all: `EventSource` and `<img src>`.
   */
  function authenticate(req: Request, res: Response, next: NextFunction): void {
    const header = req.header('authorization');
    const query = typeof req.query.token === 'string' ? req.query.token : undefined;
    const auth = store.authenticate(header ?? query);
    if (!auth) {
      res.status(401).json({ error: 'Pair this device or sign in as a caregiver first.' });
      return;
    }
    req.auth = auth;
    next();
  }

  function caregiverOnly(req: Request, res: Response, next: NextFunction): void {
    if (req.auth?.role !== 'caregiver') {
      res.status(403).json({ error: 'This action is only available to a caregiver in this household.' });
      return;
    }
    next();
  }

  // ------------------------------------------------------------------- public

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      now: new Date().toISOString(),
      ai: ai.status(),
      connectedClients: hub.count(),
      version: '1.0.0',
    });
  });

  app.post('/api/pair', (req, res, next) => {
    try {
      const body = pairRequestSchema.parse(req.body);
      const { token, household } = store.pairDevice(body.code, body.kind, body.label);
      store.recordActivity({
        householdId: household.id,
        type: 'device_paired',
        summary: `A ${body.kind === 'tv' ? 'television' : 'voice client'} was paired`,
        surface: body.kind === 'tv' ? 'tv' : 'voice',
      });
      res.json({ token, household: { id: household.id, name: household.name, timezone: household.timezone } });
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------- snapshot

  app.get('/api/snapshot', authenticate, (req, res, next) => {
    try {
      res.json(store.snapshot(req.auth!.householdId));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/events', authenticate, (req, res) => {
    const householdId = req.auth!.householdId;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const unsubscribe = hub.subscribe(householdId, res);
    // Send current state immediately so a reconnecting client is never stale.
    res.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: store.snapshot(householdId) })}\n\n`);
    const keepAlive = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping', now: new Date().toISOString() })}\n\n`);
    }, 20_000);
    keepAlive.unref?.();
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/activity', authenticate, (req, res, next) => {
    try {
      res.json({ events: store.listActivity(req.auth!.householdId) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/transcript/:surface', authenticate, (req, res, next) => {
    try {
      const surface = req.params.surface;
      if (!['voice', 'tv', 'mcp'].includes(surface)) throw new BadRequest('Unknown surface');
      res.json({ turns: assistant.transcript(req.auth!.householdId, surface) });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------------- media

  app.get('/media/:assetId', authenticate, (req, res, next) => {
    try {
      const stored = store.mediaStoredPath(req.auth!.householdId, req.params.assetId);
      if (!stored || !fs.existsSync(stored.path)) throw new NotFound('media asset');
      res.setHeader('Content-Type', stored.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      fs.createReadStream(stored.path).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/media', authenticate, caregiverOnly, upload.array('files', 10), (req, res, next) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new BadRequest('No files were uploaded.');
      const captions = Array.isArray(req.body.captions)
        ? (req.body.captions as string[])
        : typeof req.body.captions === 'string'
          ? [req.body.captions]
          : [];
      const assets = files.map((file, index) =>
        store.addMediaAsset({
          householdId: req.auth!.householdId,
          kind: file.mimetype.startsWith('image/') ? 'image' : file.mimetype.startsWith('audio/') ? 'audio' : 'video',
          filename: file.originalname,
          storedName: path.basename(file.path),
          mime: file.mimetype,
          bytes: file.size,
          caption: captions[index] ?? null,
        }),
      );
      res.json({ assets });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/media/:assetId', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const removed = store.deleteMediaAsset(req.auth!.householdId, req.params.assetId);
      if (!removed) throw new NotFound('media asset');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------- household profile

  app.get('/api/household', authenticate, (req, res, next) => {
    try {
      const householdId = req.auth!.householdId;
      res.json({
        household: store.household(householdId),
        profile: store.profile(householdId),
        pairingCode: req.auth!.role === 'caregiver' ? store.household(householdId).pairingCode : undefined,
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/household', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const { name, timezone } = req.body ?? {};
      if (timezone) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        } catch {
          throw new BadRequest(`Unknown timezone: ${timezone}`);
        }
      }
      const household = store.updateHousehold(req.auth!.householdId, { name, timezone });
      const snapshot = store.snapshot(household.id);
      hub.publish(household.id, { type: 'snapshot', snapshot });
      res.json({ household });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/profile', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const profile = store.updateProfile(req.auth!.householdId, req.body ?? {});
      const snapshot = store.snapshot(req.auth!.householdId);
      hub.publish(req.auth!.householdId, { type: 'snapshot', snapshot });
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/pairing-code/rotate', authenticate, caregiverOnly, (req, res, next) => {
    try {
      res.json({ pairingCode: store.rotatePairingCode(req.auth!.householdId) });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------------ drafts

  app.get('/api/drafts', authenticate, caregiverOnly, (req, res, next) => {
    try {
      res.json({ drafts: store.listDrafts(req.auth!.householdId) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * One conversational turn of the routine builder. The AI proposes; nothing
   * becomes executable until the caregiver publishes.
   */
  app.post('/api/drafts/message', authenticate, caregiverOnly, async (req, res, next) => {
    try {
      const householdId = req.auth!.householdId;
      const body = draftMessageRequestSchema.parse(req.body);
      store.assertMediaOwnership(householdId, [...body.mediaAssetIds, body.voiceNoteAssetId]);
      const household = store.household(householdId);
      const profile = store.profile(householdId);
      const existing = body.draftId ? store.draft(householdId, body.draftId) : null;
      if (body.draftId && !existing) throw new NotFound('draft');
      if (existing && existing.status !== 'draft') {
        throw new BadRequest('That draft has already been published. Start a revision instead.');
      }

      const attached = body.mediaAssetIds
        .map((assetId) => store.mediaAsset(householdId, assetId))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));

      const extraction = await ai.extractDraft({
        timezone: household.timezone,
        todayLocalDate: localDateInZone(store.clock.now(householdId), household.timezone),
        preferredName: profile.preferredName,
        existing: existing?.routine ?? null,
        history: existing?.sourceTurns.map((t) => ({ role: t.role, text: t.text })) ?? [],
        message: body.text,
        attached,
        library: store.listMedia(householdId),
      });

      const now = new Date().toISOString();
      const turns = [
        ...(existing?.sourceTurns ?? []),
        { role: 'caregiver' as const, text: body.text, createdAt: now },
        { role: 'assistant' as const, text: extraction.assistantMessage, createdAt: now },
      ];
      const mediaAssetIds = Array.from(new Set([...(existing?.mediaAssetIds ?? []), ...body.mediaAssetIds]));
      // Raw audio is kept only when the caregiver explicitly opted in.
      const voiceNoteAssetId = body.keepVoiceNote ? (body.voiceNoteAssetId ?? existing?.voiceNoteAssetId ?? null) : null;
      if (!body.keepVoiceNote && body.voiceNoteAssetId) {
        store.deleteMediaAsset(householdId, body.voiceNoteAssetId);
      }

      const draft = existing
        ? store.updateDraft(householdId, existing.id, {
            routine: extraction.routine,
            missing: extraction.missing,
            sourceTurns: turns,
            mediaAssetIds,
            voiceNoteAssetId,
            aiProvider: ai.name,
          })
        : store.createDraft({
            householdId,
            routine: extraction.routine,
            missing: extraction.missing,
            sourceTurns: turns,
            mediaAssetIds,
            voiceNoteAssetId,
            aiProvider: ai.name,
          });

      res.json({
        draft,
        assistantMessage: extraction.assistantMessage,
        followUpQuestion: extraction.followUpQuestion,
        aiProvider: ai.name,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/drafts/:draftId/publish', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const householdId = req.auth!.householdId;
      const replaceRoutineId = typeof req.body?.replaceRoutineId === 'string' ? req.body.replaceRoutineId : undefined;
      const draft = store.draft(householdId, req.params.draftId);
      if (!draft) throw new NotFound('draft');
      const routine = store.publishDraft(householdId, req.params.draftId, replaceRoutineId);

      // A change the caregiver scoped to one day becomes an override, so the
      // recurring schedule is untouched.
      if (draft.routine.oneOff) {
        store.upsertOverride({
          householdId,
          routineId: routine.id,
          localDate: draft.routine.oneOff.localDate,
          localTime: draft.routine.oneOff.localTime,
          skipped: false,
          note: draft.routine.oneOff.note,
        });
      }

      store.recordActivity({
        householdId,
        type: 'routine_published',
        summary: `${routine.title} published (version ${routine.version})`,
        surface: 'dashboard',
        detail: { routineId: routine.id, version: routine.version },
      });
      const snapshot = store.snapshot(householdId);
      hub.publish(householdId, { type: 'snapshot', snapshot });
      res.json({ routine, snapshot });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/drafts/:draftId/discard', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const draft = store.updateDraft(req.auth!.householdId, req.params.draftId, { status: 'discarded' });
      res.json({ draft });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/drafts/:draftId/voice-note', authenticate, caregiverOnly, (req, res, next) => {
    try {
      res.json({ draft: store.deleteDraftVoiceNote(req.auth!.householdId, req.params.draftId) });
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------- routines

  app.get('/api/routines', authenticate, (req, res, next) => {
    try {
      res.json({ routines: store.listRoutines(req.auth!.householdId, true) });
    } catch (error) {
      next(error);
    }
  });

  /** Start a new draft seeded from a published routine, for conversational edits. */
  app.post('/api/routines/:routineId/revise', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const householdId = req.auth!.householdId;
      const routine = store.routine(householdId, req.params.routineId);
      if (!routine) throw new NotFound('routine');
      const draft = store.createDraft({
        householdId,
        routine: {
          title: routine.title,
          days: routine.days,
          localTime: routine.localTime,
          timezone: routine.timezone,
          instructions: routine.instructions,
          greeting: routine.greeting,
          steps: routine.steps.map((s) => ({ title: s.title, body: s.body, mediaAssetId: s.mediaAssetId })),
          alternatives: routine.alternatives.map((a) => ({
            situation: a.situation,
            response: a.response,
            mediaAssetId: a.mediaAssetId,
          })),
          heroMediaAssetId: routine.heroMediaAssetId,
          followUpMinutes: routine.followUpMinutes,
          helpPolicy: routine.helpPolicy,
          oneOff: null,
        },
        missing: [],
        sourceTurns: [
          {
            role: 'assistant',
            text: `Revising "${routine.title}". Tell me what should change.`,
            createdAt: new Date().toISOString(),
          },
        ],
        mediaAssetIds: [],
        voiceNoteAssetId: null,
        aiProvider: ai.name,
      });
      res.json({ draft, replaceRoutineId: routine.id });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/routines/:routineId/active', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const active = Boolean(req.body?.active);
      const routine = store.setRoutineActive(req.auth!.householdId, req.params.routineId, active);
      const snapshot = store.snapshot(req.auth!.householdId);
      hub.publish(req.auth!.householdId, { type: 'snapshot', snapshot });
      res.json({ routine });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/overrides', authenticate, (req, res, next) => {
    try {
      res.json({ overrides: store.listOverrides(req.auth!.householdId) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/overrides', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const body = overrideRequestSchema.parse(req.body);
      const override = store.upsertOverride({ householdId: req.auth!.householdId, ...body });
      store.recordActivity({
        householdId: req.auth!.householdId,
        type: 'routine_override',
        summary: body.skipped
          ? `One-day change: skipped on ${body.localDate}`
          : `One-day change: ${body.localDate} at ${body.localTime}`,
        surface: 'dashboard',
        detail: { ...body },
      });
      const snapshot = store.snapshot(req.auth!.householdId);
      hub.publish(req.auth!.householdId, { type: 'snapshot', snapshot });
      res.json({ override, snapshot });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------- occurrence commands

  const occurrenceRoute = (
    action: 'start' | 'back' | 'repeat' | 'complete' | 'skip',
  ) => (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = occurrenceCommandSchema.parse(req.body ?? {});
      const result = commands[action](req.auth!.householdId, req.params.occurrenceId, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  app.post('/api/occurrences/:occurrenceId/start', authenticate, occurrenceRoute('start'));
  app.post('/api/occurrences/:occurrenceId/back', authenticate, occurrenceRoute('back'));
  app.post('/api/occurrences/:occurrenceId/repeat', authenticate, occurrenceRoute('repeat'));
  app.post('/api/occurrences/:occurrenceId/complete', authenticate, occurrenceRoute('complete'));
  app.post('/api/occurrences/:occurrenceId/skip', authenticate, occurrenceRoute('skip'));

  app.post('/api/occurrences/:occurrenceId/advance', authenticate, (req, res, next) => {
    try {
      const body = advanceCommandSchema.parse(req.body ?? {});
      res.json(
        commands.advance(req.auth!.householdId, req.params.occurrenceId, body.confirmedStepIndex, body),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/occurrences/:occurrenceId/postpone', authenticate, (req, res, next) => {
    try {
      const body = postponeCommandSchema.parse(req.body ?? {});
      res.json(commands.postpone(req.auth!.householdId, req.params.occurrenceId, body.minutes, body));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/occurrences/:occurrenceId/goto', authenticate, (req, res, next) => {
    try {
      const body = occurrenceCommandSchema.parse(req.body ?? {});
      const stepIndex = Number(req.body?.stepIndex ?? 0);
      res.json(commands.goToStep(req.auth!.householdId, req.params.occurrenceId, stepIndex, body));
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------- help

  app.get('/api/help-requests', authenticate, (req, res, next) => {
    try {
      res.json({ helpRequests: store.listHelpRequests(req.auth!.householdId) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/help-requests', authenticate, (req, res, next) => {
    try {
      const body = helpRequestCreateSchema.parse(req.body);
      const result = commands.createHelpRequest(req.auth!.householdId, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/help-requests/:helpId/acknowledge', authenticate, caregiverOnly, (req, res, next) => {
    try {
      res.json(commands.setHelpStatus(req.auth!.householdId, req.params.helpId, 'acknowledged'));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/help-requests/:helpId/resolve', authenticate, caregiverOnly, (req, res, next) => {
    try {
      res.json(commands.setHelpStatus(req.auth!.householdId, req.params.helpId, 'resolved'));
    } catch (error) {
      next(error);
    }
  });

  // --------------------------------------------------------------- assistant

  app.post('/api/assistant/turn', authenticate, async (req, res, next) => {
    try {
      const body = assistantTurnRequestSchema.parse(req.body);
      res.json(await assistant.turn(req.auth!.householdId, body));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/ai/status', authenticate, (_req, res) => {
    res.json(ai.status());
  });

  // -------------------------------------------------------------- demo clock

  app.post('/api/demo-clock', authenticate, caregiverOnly, (req, res, next) => {
    try {
      const householdId = req.auth!.householdId;
      const body = demoClockRequestSchema.parse(req.body);
      const household = store.household(householdId);
      let state = store.clock.state(householdId);
      switch (body.action) {
        case 'advance':
          state = store.clock.advance(householdId, body.minutes ?? 15);
          break;
        case 'set': {
          if (!body.localTime) throw new BadRequest('A local time is required to set the demo clock.');
          const real = new Date();
          const today = localDateInZone(real, household.timezone);
          const target = zonedTimeToInstant(today, body.localTime, household.timezone);
          state = store.clock.setOffset(householdId, target.getTime() - real.getTime(), true);
          break;
        }
        case 'reset':
          state = store.clock.reset(householdId);
          break;
        case 'enable':
          state = store.clock.setOffset(householdId, state.offsetMs, true);
          break;
        case 'disable':
          state = store.clock.setOffset(householdId, state.offsetMs, false);
          break;
      }
      // Moving the clock re-arms anything that is now in the future, so a
      // rehearsed demo can be replayed without resetting the database.
      commands.rearmAnnouncements(householdId);
      // Run a sweep immediately so the demo does not wait for the next tick.
      const swept = scheduler.tick();
      const snapshot = store.snapshot(householdId);
      hub.publish(householdId, { type: 'snapshot', snapshot });
      res.json({ demoClock: state, swept, snapshot });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/scheduler/tick', authenticate, caregiverOnly, (_req, res) => {
    res.json(scheduler.tick());
  });

  // --------------------------------------------------------------------- ring

  /**
   * Local Ring event injection.
   *
   * This endpoint is a *simulator* input, not the Ring cloud. It accepts the
   * subset of fields a doorbell "ding" actually carries and nothing more — no
   * identity, no indoor activity, no video stream. See docs/INTEGRATIONS.md.
   */
  app.post('/api/ring/simulate', authenticate, (req, res, next) => {
    try {
      const householdId = req.auth!.householdId;
      const body = ringSimulateSchema.parse(req.body ?? {});
      store.assertMediaOwnership(householdId, [body.snapshotAssetId]);
      const event: RingVisitorEvent = {
        id: id('ring'),
        kind: body.kind,
        deviceName: body.deviceName,
        receivedAt: new Date().toISOString(),
        source: 'simulator',
        snapshotAssetId: body.snapshotAssetId,
      };
      db.prepare(
        `INSERT INTO ring_events (id, household_id, kind, device_name, source, snapshot_asset_id, received_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(event.id, householdId, event.kind, event.deviceName, event.source, event.snapshotAssetId, event.receivedAt);
      store.recordActivity({
        householdId,
        type: 'ring_event',
        summary: `${event.kind === 'ding' ? 'Doorbell' : 'Motion'} at the ${event.deviceName} (simulated)`,
        surface: 'system',
        detail: { ...event },
      });
      const snapshot = store.snapshot(householdId);
      hub.publish(householdId, { type: 'ring_event', event, snapshot });
      res.json({ event });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/ring/events', authenticate, (req, res, next) => {
    try {
      const rows = db
        .prepare('SELECT * FROM ring_events WHERE household_id=? ORDER BY received_at DESC LIMIT 20')
        .all(req.auth!.householdId) as any[];
      res.json({
        events: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          deviceName: r.device_name,
          receivedAt: r.received_at,
          source: r.source,
          snapshotAssetId: r.snapshot_asset_id,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------------- MCP

  app.use('/mcp', createMcpRouter({ store, commands, assistant }));

  // ------------------------------------------------------------------- errors

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof Conflict) {
      res.status(409).json({ error: error.message, current: error.current });
      return;
    }
    if (error instanceof NotFound) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof BadRequest) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (typeof error === 'object' && error && 'issues' in error) {
      res.status(400).json({ error: 'That request did not match what the server expects.', issues: (error as any).issues });
      return;
    }
    console.error('[server] unhandled error', error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return { app, db, store, commands, assistant, scheduler, hub, ai };
}
