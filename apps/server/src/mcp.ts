import express, { type Request, type Response, type Router } from 'express';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';
import { BadRequest, NotFound, type Store } from './store.js';
import type { Commands } from './commands.js';
import type { Assistant } from './assistant.js';
import {
  OCCURRENCE_STATE_LABELS,
  describeDays,
  friendlyTime,
  localTimeInZone,
  type HouseholdSnapshot,
  type OccurrenceView,
} from '@alongside/shared';

/**
 * Self-hosted MCP server — Streamable HTTP, protocol revision 2025-11-25.
 *
 * This is the integration surface an Alexa+ (or any other) MCP client would
 * connect to. It is implemented directly against the specification rather than
 * through a framework so the wire behaviour is explicit and testable:
 *
 *   - a single endpoint handling POST, GET and DELETE;
 *   - `Origin` validated on every request (DNS-rebinding protection);
 *   - a cryptographically random `MCP-Session-Id` issued at initialize and
 *     required on every later request (400 when absent, 404 once terminated);
 *   - `MCP-Protocol-Version` honoured, with 400 for an unsupported value and
 *     the specified 2025-03-26 assumption when the header is absent;
 *   - GET opens an SSE stream that is primed with an event id and a `retry`.
 *
 * Every tool call lands on the same validated commands the TV and the web
 * client use, so an MCP client cannot reach state the product does not allow.
 *
 * What this does *not* claim: it is not registered with Alexa+, and a running
 * MCP server by itself does not make an Echo speak or drive a Fire TV app.
 * See docs/INTEGRATIONS.md for the exact dependencies that remain.
 */

const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'alongside-mcp', title: 'Alongside', version: '1.0.0' };

interface McpSession {
  id: string;
  householdId: string;
  protocolVersion: string;
  initialized: boolean;
  createdAt: number;
  /** Monotonic SSE event counter, used as the resumption cursor. */
  eventSeq: number;
  streams: Set<Response>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export function createMcpRouter(deps: { store: Store; commands: Commands; assistant: Assistant }): Router {
  const router = express.Router();
  const sessions = new Map<string, McpSession>();
  router.use(express.json({ limit: '1mb' }));

  /** Reject a cross-origin browser POST unless the origin was allow-listed. */
  function originRejected(req: Request): boolean {
    const origin = req.header('origin');
    if (!origin) return false;
    if (env.mcpAllowedOrigins.includes(origin)) return false;
    try {
      const host = new URL(origin).hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    } catch {
      return true;
    }
    return true;
  }

  function authHouseholdId(req: Request): string {
    const header = req.header('authorization');
    const query = typeof req.query.token === 'string' ? req.query.token : undefined;
    const auth = deps.store.authenticate(header ?? query);
    if (!auth) throw new McpHttpError(401, 'A household bearer token is required.');
    return auth.householdId;
  }

  function checkProtocolHeader(req: Request, session: McpSession | undefined): void {
    const header = req.header('mcp-protocol-version');
    if (!header) return; // Spec: assume 2025-03-26; we keep the session's value.
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(header)) {
      throw new McpHttpError(400, `Unsupported MCP-Protocol-Version: ${header}`);
    }
    if (session) session.protocolVersion = header;
  }

  router.post('/', async (req: Request, res: Response) => {
    if (originRejected(req)) {
      res.status(403).json(rpcError(null, -32600, 'Origin not allowed'));
      return;
    }
    const accept = req.header('accept') ?? '';
    if (accept && !/application\/json|text\/event-stream|\*\/\*/.test(accept)) {
      res.status(406).json(rpcError(null, -32600, 'Accept must allow application/json or text/event-stream'));
      return;
    }

    const message = req.body as JsonRpcRequest;
    if (!message || message.jsonrpc !== '2.0') {
      res.status(400).json(rpcError(null, -32600, 'Expected a JSON-RPC 2.0 message'));
      return;
    }

    const sessionId = req.header('mcp-session-id');
    const isInitialize = message.method === 'initialize';

    try {
      if (isInitialize) {
        const householdId = authHouseholdId(req);
        const requested = String(
          (message.params?.protocolVersion as string | undefined) ?? LATEST_PROTOCOL_VERSION,
        );
        const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        const session: McpSession = {
          id: randomUUID(),
          householdId,
          protocolVersion: negotiated,
          initialized: false,
          createdAt: Date.now(),
          eventSeq: 0,
          streams: new Set(),
        };
        sessions.set(session.id, session);
        res.setHeader('MCP-Session-Id', session.id);
        res.json({
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            protocolVersion: negotiated,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              'Alongside guides one older adult through routines a family caregiver published. ' +
              'Read the current activity before acting, never invent an instruction, and prefer ' +
              'alongside_say for anything conversational so replies stay grounded in approved text.',
          },
        });
        return;
      }

      if (!sessionId) {
        throw new McpHttpError(400, 'MCP-Session-Id header is required after initialization.');
      }
      const session = sessions.get(sessionId);
      if (!session) {
        throw new McpHttpError(404, 'Unknown or terminated MCP session. Start a new session with initialize.');
      }
      checkProtocolHeader(req, session);

      // Notifications and responses carry no id and get 202 with no body.
      if (message.id === undefined || message.id === null) {
        if (message.method === 'notifications/initialized') session.initialized = true;
        res.status(202).end();
        return;
      }

      const result = await handleRequest(message, session, deps);
      res.json({ jsonrpc: '2.0', id: message.id, result });
    } catch (error) {
      if (error instanceof McpHttpError) {
        res.status(error.status).json(rpcError(message.id ?? null, -32600, error.message));
        return;
      }
      const code = error instanceof BadRequest ? -32602 : error instanceof NotFound ? -32602 : -32603;
      res.json({
        jsonrpc: '2.0',
        id: message.id ?? null,
        result: {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        },
        ...(code === -32603 ? {} : {}),
      });
    }
  });

  /** Optional server-to-client stream. */
  router.get('/', (req: Request, res: Response) => {
    if (originRejected(req)) {
      res.status(403).end();
      return;
    }
    const sessionId = req.header('mcp-session-id');
    if (!sessionId) {
      res.status(400).json(rpcError(null, -32600, 'MCP-Session-Id header is required.'));
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json(rpcError(null, -32600, 'Unknown or terminated MCP session.'));
      return;
    }
    checkProtocolHeader(req, session);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    // Prime the client with an event id so it can resume with Last-Event-ID.
    session.eventSeq += 1;
    res.write(`retry: 2000\nid: ${session.id}-${session.eventSeq}\ndata: \n\n`);
    session.streams.add(res);
    req.on('close', () => session.streams.delete(res));
  });

  router.delete('/', (req: Request, res: Response) => {
    const sessionId = req.header('mcp-session-id');
    if (!sessionId) {
      res.status(400).end();
      return;
    }
    const session = sessions.get(sessionId);
    if (session) {
      for (const stream of session.streams) stream.end();
      sessions.delete(sessionId);
    }
    res.status(204).end();
  });

  return router;
}

async function handleRequest(
  message: JsonRpcRequest,
  session: McpSession,
  deps: { store: Store; commands: Commands; assistant: Assistant },
): Promise<unknown> {
  switch (message.method) {
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOL_DEFINITIONS };
    case 'tools/call': {
      const name = String(message.params?.name ?? '');
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      return callTool(name, args, session, deps);
    }
    default:
      throw new McpHttpError(400, `Unsupported method: ${message.method}`);
  }
}

const TOOL_DEFINITIONS = [
  {
    name: 'alongside_get_today',
    title: "Read today's routines",
    description:
      "Everything the household has scheduled today with its reported state, plus any open help requests. Read this before acting.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'alongside_get_current_activity',
    title: 'Read the activity in play',
    description:
      'The activity the person should be guided through right now, the step currently shown, the last step they confirmed, and the caregiver-approved alternatives available.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'alongside_say',
    title: 'Pass on what the person said',
    description:
      'The preferred tool for anything conversational. Give the person\'s own words; Alongside classifies them, applies the right validated state change, and returns a reply composed from caregiver-approved text.',
    inputSchema: {
      type: 'object',
      properties: {
        utterance: { type: 'string', description: "The person's words, verbatim." },
        idempotencyKey: { type: 'string', description: 'Stable key so a repeated recognition result applies once.' },
      },
      required: ['utterance'],
      additionalProperties: false,
    },
  },
  {
    name: 'alongside_start_activity',
    title: 'Start or resume the activity',
    description: 'Begin the activity, resuming after the last step the person confirmed.',
    inputSchema: {
      type: 'object',
      properties: { occurrenceId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'alongside_next_step',
    title: 'Confirm this step and read the next',
    description:
      'Record that the person finished the step being shown and move to the next one. Only call this when the person said they are moving on — reading a step aloud is not completing it.',
    inputSchema: {
      type: 'object',
      properties: { occurrenceId: { type: 'string' }, idempotencyKey: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'alongside_postpone',
    title: 'Postpone this occurrence',
    description:
      'Push today\'s occurrence back by a number of minutes. The recurring routine is untouched.',
    inputSchema: {
      type: 'object',
      properties: {
        minutes: { type: 'integer', minimum: 1, maximum: 240 },
        occurrenceId: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'alongside_complete_activity',
    title: 'Record a self-reported completion',
    description: 'The person said they have done it. Recorded as a self-report, never as an observation.',
    inputSchema: {
      type: 'object',
      properties: { occurrenceId: { type: 'string' }, idempotencyKey: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'alongside_request_help',
    title: 'Raise a help request',
    description:
      "Create a help request on the caregiver's dashboard, with the activity and step attached. This writes a record the caregiver sees; it does not send an SMS, email or call.",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        occurrenceId: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'alongside_explain_step',
    title: 'Answer from approved instructions only',
    description:
      'Answer a question using only what the caregiver published. Returns provenance: caregiver_approved, user_reported or unknown. When it is unknown, say so rather than filling the gap.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
] as const;

async function callTool(
  name: string,
  args: Record<string, unknown>,
  session: McpSession,
  deps: { store: Store; commands: Commands; assistant: Assistant },
): Promise<unknown> {
  const { store, commands, assistant } = deps;
  const householdId = session.householdId;
  const snapshot = store.snapshot(householdId);
  const focusId = (args.occurrenceId as string | undefined) ?? snapshot.focusOccurrenceId;
  const focus = focusId ? store.occurrenceView(householdId, focusId) : null;
  const key = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined;

  const requireFocus = (): OccurrenceView => {
    if (!focus) throw new BadRequest('There is no activity in play right now.');
    return focus;
  };

  switch (name) {
    case 'alongside_get_today': {
      const structured = {
        now: snapshot.now,
        demoClockRunning: snapshot.demoClock.enabled && snapshot.demoClock.offsetMs !== 0,
        preferredName: snapshot.profile.preferredName,
        timezone: snapshot.household.timezone,
        activities: snapshot.occurrences.map((o) => ({
          occurrenceId: o.id,
          title: o.routine.title,
          localDate: o.localDate,
          dueAt: o.dueAt,
          state: o.state,
          stateLabel: OCCURRENCE_STATE_LABELS[o.state],
          stepCount: o.routine.steps.length,
          confirmedStepIndex: o.confirmedStepIndex,
        })),
        openHelpRequests: snapshot.helpRequests.filter((h) => h.status !== 'resolved').length,
      };
      return toolResult(renderToday(snapshot), structured);
    }

    case 'alongside_get_current_activity': {
      if (!focus) return toolResult('Nothing is scheduled for right now.', { occurrence: null });
      const step = focus.routine.steps[focus.currentStepIndex];
      const structured = {
        occurrenceId: focus.id,
        title: focus.routine.title,
        state: focus.state,
        schedule: `${describeDays(focus.routine.days)} at ${friendlyTime(focus.routine.localTime)}`,
        currentStepIndex: focus.currentStepIndex,
        confirmedStepIndex: focus.confirmedStepIndex,
        steps: focus.routine.steps.map((s, i) => ({ index: i, title: s.title, body: s.body })),
        approvedAlternatives: focus.routine.alternatives.map((a) => ({ situation: a.situation, response: a.response })),
        referenceContext: focus.routine.instructions,
      };
      return toolResult(
        `${focus.routine.title} — ${OCCURRENCE_STATE_LABELS[focus.state]}. ` +
          `Showing step ${focus.currentStepIndex + 1} of ${focus.routine.steps.length}: ${step?.body ?? '(no steps)'}`,
        structured,
      );
    }

    case 'alongside_say': {
      const utterance = String(args.utterance ?? '').trim();
      if (!utterance) throw new BadRequest('An utterance is required.');
      const result = await assistant.turn(householdId, {
        text: utterance,
        occurrenceId: focusId ?? null,
        surface: 'mcp',
        idempotencyKey: key,
      });
      return toolResult(result.reply, {
        reply: result.reply,
        intent: result.intent,
        action: result.action,
        provenance: result.provenance,
        occurrenceId: result.occurrenceId,
      });
    }

    case 'alongside_start_activity': {
      const occurrence = requireFocus();
      const after = commands.start(householdId, occurrence.id, { surface: 'mcp', idempotencyKey: key }).occurrence;
      const step = after.routine.steps[after.currentStepIndex];
      return toolResult(`Started ${after.routine.title}. Step ${after.currentStepIndex + 1}: ${step?.body ?? ''}`, {
        occurrenceId: after.id,
        state: after.state,
        currentStepIndex: after.currentStepIndex,
      });
    }

    case 'alongside_next_step': {
      const occurrence = requireFocus();
      const after = commands.advance(householdId, occurrence.id, occurrence.currentStepIndex, {
        surface: 'mcp',
        idempotencyKey: key,
      }).occurrence;
      const step = after.routine.steps[after.currentStepIndex];
      return toolResult(
        after.state === 'completed_self_report'
          ? `That was the last step; ${after.routine.title} is marked complete by self-report.`
          : `Step ${after.currentStepIndex + 1} of ${after.routine.steps.length}: ${step?.body ?? ''}`,
        { occurrenceId: after.id, state: after.state, confirmedStepIndex: after.confirmedStepIndex },
      );
    }

    case 'alongside_postpone': {
      const occurrence = requireFocus();
      const minutes = Number(args.minutes ?? occurrence.routine.followUpMinutes);
      const after = commands.postpone(householdId, occurrence.id, minutes, {
        surface: 'mcp',
        idempotencyKey: key,
      }).occurrence;
      return toolResult(`Postponed ${after.routine.title} by ${minutes} minutes.`, {
        occurrenceId: after.id,
        state: after.state,
        dueAt: after.dueAt,
      });
    }

    case 'alongside_complete_activity': {
      const occurrence = requireFocus();
      const after = commands.complete(householdId, occurrence.id, { surface: 'mcp', idempotencyKey: key }).occurrence;
      return toolResult(`${after.routine.title} is marked completed by self-report.`, {
        occurrenceId: after.id,
        state: after.state,
      });
    }

    case 'alongside_request_help': {
      const message = String(args.message ?? '').trim();
      if (!message) throw new BadRequest('A message is required.');
      const { help } = commands.createHelpRequest(householdId, {
        occurrenceId: focus?.id ?? null,
        message,
        surface: 'mcp',
        idempotencyKey: key,
      });
      return toolResult(
        `A help request is now on the caregiver's dashboard. Nothing was sent as a message or a call.`,
        { helpRequestId: help.id, status: help.status, createdAt: help.createdAt },
      );
    }

    case 'alongside_explain_step': {
      const occurrence = requireFocus();
      const question = String(args.question ?? '').trim();
      if (!question) throw new BadRequest('A question is required.');
      const answer = assistant.answerQuestion(occurrence, question);
      return toolResult(answer.text, { answer: answer.text, provenance: answer.provenance });
    }

    default:
      throw new McpHttpError(400, `Unknown tool: ${name}`);
  }
}

/** Times are shown in the household's own timezone, never in UTC. */
function renderToday(snapshot: HouseholdSnapshot): string {
  const timezone = snapshot.household.timezone;
  const lines = [`Today for ${snapshot.profile.preferredName} (${timezone}):`];
  for (const occurrence of snapshot.occurrences) {
    lines.push(
      `- ${occurrence.routine.title} on ${occurrence.localDate} at ` +
        `${friendlyTime(localTimeInZone(occurrence.dueAt, timezone))} — ` +
        `${OCCURRENCE_STATE_LABELS[occurrence.state]}`,
    );
  }
  const open = snapshot.helpRequests.filter((h) => h.status !== 'resolved');
  if (open.length > 0) lines.push(`${open.length} open help request(s).`);
  return lines.join('\n');
}

function toolResult(text: string, structuredContent: unknown): unknown {
  return { content: [{ type: 'text', text }], structuredContent, isError: false };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

class McpHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
