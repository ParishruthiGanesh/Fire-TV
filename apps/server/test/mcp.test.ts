import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHarness, publishRoutine, setClock, type Harness } from './helpers.js';

let h: Harness;
afterEach(() => h?.cleanup());

const ACCEPT = 'application/json, text/event-stream';

async function initialize(harness: Harness, protocolVersion = '2025-11-25') {
  const response = await request(harness.app)
    .post('/mcp')
    .set('authorization', `Bearer ${harness.caregiverToken}`)
    .set('accept', ACCEPT)
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });
  return { response, sessionId: response.headers['mcp-session-id'] as string };
}

function call(harness: Harness, sessionId: string, name: string, args: Record<string, unknown> = {}, id = 9) {
  return request(harness.app)
    .post('/mcp')
    .set('authorization', `Bearer ${harness.caregiverToken}`)
    .set('accept', ACCEPT)
    .set('mcp-session-id', sessionId)
    .set('mcp-protocol-version', '2025-11-25')
    .send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

describe('MCP Streamable HTTP transport, spec 2025-11-25', () => {
  it('negotiates the protocol version and issues a session id', async () => {
    h = createHarness();
    const { response, sessionId } = await initialize(h);
    expect(response.status).toBe(200);
    expect(response.body.result.protocolVersion).toBe('2025-11-25');
    expect(response.body.result.serverInfo.name).toBe('alongside-mcp');
    expect(response.body.result.capabilities.tools).toBeDefined();
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back to its latest supported version for an unknown request', async () => {
    h = createHarness();
    const { response } = await initialize(h, '2099-01-01');
    expect(response.body.result.protocolVersion).toBe('2025-11-25');
  });

  it('requires a bearer token to initialize', async () => {
    h = createHarness();
    const response = await request(h.app)
      .post('/mcp')
      .set('accept', ACCEPT)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    expect(response.status).toBe(401);
  });

  it('answers 202 with no body to notifications/initialized', async () => {
    h = createHarness();
    const { sessionId } = await initialize(h);
    const response = await request(h.app)
      .post('/mcp')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .set('accept', ACCEPT)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('rejects a request without a session id, and an unknown session with 404', async () => {
    h = createHarness();
    await initialize(h);
    const noSession = await request(h.app)
      .post('/mcp')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .set('accept', ACCEPT)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(noSession.status).toBe(400);

    const unknown = await request(h.app)
      .post('/mcp')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .set('accept', ACCEPT)
      .set('mcp-session-id', '11111111-2222-3333-4444-555555555555')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(unknown.status).toBe(404);
  });

  it('rejects an unsupported MCP-Protocol-Version header with 400', async () => {
    h = createHarness();
    const { sessionId } = await initialize(h);
    const response = await request(h.app)
      .post('/mcp')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .set('accept', ACCEPT)
      .set('mcp-session-id', sessionId)
      .set('mcp-protocol-version', '2001-01-01')
      .send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(response.status).toBe(400);
  });

  it('rejects a foreign Origin header with 403', async () => {
    h = createHarness();
    const response = await request(h.app)
      .post('/mcp')
      .set('origin', 'https://evil.example.com')
      .set('accept', ACCEPT)
      .send({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    expect(response.status).toBe(403);
  });

  it('opens an SSE stream on GET, primed with an event id and a retry', async () => {
    h = createHarness();
    const { sessionId } = await initialize(h);
    const server = h.app.listen(0);
    const port = (server.address() as any).port;
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('retry:');
    expect(text).toContain(`id: ${sessionId}-1`);
    await reader.cancel().catch(() => {});
    server.close();
  });

  it('terminates a session on DELETE and then returns 404 for it', async () => {
    h = createHarness();
    const { sessionId } = await initialize(h);
    const deleted = await request(h.app).delete('/mcp').set('mcp-session-id', sessionId);
    expect(deleted.status).toBe(204);
    const after = await request(h.app)
      .post('/mcp')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .set('accept', ACCEPT)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
    expect(after.status).toBe(404);
  });
});

describe('MCP tools reach the same validated state as every other surface', () => {
  it('lists the tools with input schemas', async () => {
    h = createHarness();
    const { sessionId } = await initialize(h);
    const response = await request(h.app)
      .post('/mcp')
      .set('authorization', `Bearer ${h.caregiverToken}`)
      .set('accept', ACCEPT)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    const names = response.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('alongside_get_today');
    expect(names).toContain('alongside_say');
    expect(names).toContain('alongside_request_help');
    for (const tool of response.body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('postpones through a tool call and the snapshot agrees', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const { sessionId } = await initialize(h);

    const response = await call(h, sessionId, 'alongside_postpone', { minutes: 15, idempotencyKey: 'mcp-1' });
    expect(response.body.result.isError).toBe(false);
    expect(response.body.result.content[0].text).toMatch(/postponed/i);

    const snapshot = h.store.snapshot(h.householdId);
    const occurrence = snapshot.occurrences.find((o) => o.routineId === routine.id)!;
    expect(occurrence.state).toBe('postponed');
    expect(h.store.routine(h.householdId, routine.id)!.localTime).toBe('08:00');
  });

  it('answers only from approved instructions and reports provenance', async () => {
    h = createHarness();
    publishRoutine(h);
    setClock(h, '08:05');
    const { sessionId } = await initialize(h);

    const known = await call(h, sessionId, 'alongside_explain_step', { question: 'Where is my breakfast?' });
    expect(known.body.result.structuredContent.provenance).toBe('caregiver_approved');
    expect(known.body.result.structuredContent.answer).toMatch(/yellow container/i);

    const unknown = await call(h, sessionId, 'alongside_explain_step', { question: 'What is the wifi password?' });
    expect(unknown.body.result.structuredContent.provenance).toBe('unknown');
    expect(unknown.body.result.structuredContent.answer).toMatch(/don't have that written down/i);
  });

  it('does not duplicate a help request when the same tool call is retried', async () => {
    h = createHarness();
    publishRoutine(h);
    setClock(h, '08:05');
    const { sessionId } = await initialize(h);

    await call(h, sessionId, 'alongside_request_help', { message: 'I am stuck', idempotencyKey: 'help-mcp' }, 11);
    await call(h, sessionId, 'alongside_request_help', { message: 'I am stuck', idempotencyKey: 'help-mcp' }, 12);
    expect(h.store.listHelpRequests(h.householdId)).toHaveLength(1);
  });

  it('is explicit that a help request is a dashboard record, not a message', async () => {
    h = createHarness();
    publishRoutine(h);
    setClock(h, '08:05');
    const { sessionId } = await initialize(h);
    const response = await call(h, sessionId, 'alongside_request_help', { message: 'Can you call Anna?' }, 13);
    expect(response.body.result.content[0].text).toMatch(/nothing was sent/i);
  });
});
