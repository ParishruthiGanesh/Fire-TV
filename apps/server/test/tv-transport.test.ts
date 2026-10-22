import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { createHarness, publishRoutine, setClock, todaysOccurrence, type Harness } from './helpers.js';

/**
 * The transport the Fire TV app actually uses.
 *
 * React Native has no EventSource and no streaming fetch, so the television
 * connects over a WebSocket. These tests exercise that path the way the app
 * does: token in the query string, a snapshot on connect, and live updates
 * when any other surface changes something.
 */

let h: Harness;
let server: ReturnType<Harness['app']['listen']> | null = null;
let wss: WebSocketServer | null = null;

afterEach(() => {
  wss?.close();
  server?.close();
  wss = null;
  server = null;
  h?.cleanup();
});

/** Mirror of the production wiring in src/index.ts, for an ephemeral port. */
function listen(harness: Harness): Promise<number> {
  return new Promise((resolve) => {
    server = harness.app.listen(0, () => {
      wss = new WebSocketServer({ server: server!, path: '/ws' });
      wss.on('connection', (socket, request) => {
        const url = new URL(request.url ?? '/ws', 'http://localhost');
        const auth = harness.store.authenticate(url.searchParams.get('token') ?? undefined);
        if (!auth) {
          socket.close(4401, 'unauthorised');
          return;
        }
        const unsubscribe = harness.hub.subscribeSocket(auth.householdId, socket);
        socket.send(JSON.stringify({ type: 'snapshot', snapshot: harness.store.snapshot(auth.householdId) }));
        socket.on('close', unsubscribe);
      });
      resolve((server!.address() as any).port);
    });
  });
}

function nextMessage(socket: WebSocket, predicate: (event: any) => boolean, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a matching event')), timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const event = JSON.parse(String(raw));
      if (predicate(event)) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(event);
      }
    };
    socket.on('message', onMessage);
  });
}

describe('the Fire TV WebSocket transport', () => {
  it('sends the current snapshot as soon as the television connects', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const port = await listen(h);
    const { token } = h.store.pairDevice(h.store.household(h.householdId).pairingCode, 'tv');

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const event = await nextMessage(socket, (e) => e.type === 'snapshot');
    expect(event.snapshot.occurrences.some((o: any) => o.routineId === routine.id)).toBe(true);
    expect(event.snapshot.caregiverName).toBe('Anna');
    socket.close();
  });

  it('pushes a change made on another surface to the television', async () => {
    h = createHarness();
    const { routine } = publishRoutine(h);
    setClock(h, '08:05');
    const port = await listen(h);
    const { token } = h.store.pairDevice(h.store.household(h.householdId).pairingCode, 'tv');
    const occurrence = todaysOccurrence(h, routine.id);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await nextMessage(socket, (e) => e.type === 'snapshot');

    // The voice client postpones; the television must hear about it.
    h.commands.postpone(h.householdId, occurrence.id, 15, { surface: 'voice' });
    const update = await nextMessage(
      socket,
      (e) => e.type === 'snapshot' && e.snapshot.occurrences.some((o: any) => o.id === occurrence.id && o.state === 'postponed'),
    );
    expect(update.snapshot.occurrences.find((o: any) => o.id === occurrence.id).state).toBe('postponed');
    socket.close();
  });

  it('refuses a connection without a valid household token', async () => {
    h = createHarness();
    const port = await listen(h);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=not-a-real-token`);
    const code = await new Promise<number>((resolve) => socket.on('close', resolve));
    expect(code).toBe(4401);
  });

  it('announces a due routine to the television without it asking', async () => {
    h = createHarness();
    publishRoutine(h);
    setClock(h, '07:55');
    const port = await listen(h);
    const { token } = h.store.pairDevice(h.store.household(h.householdId).pairingCode, 'tv');

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await nextMessage(socket, (e) => e.type === 'snapshot');

    setClock(h, '08:01');
    h.scheduler.tick();

    const spoken = await nextMessage(socket, (e) => e.type === 'speak');
    expect(spoken.text).toMatch(/breakfast/i);
    socket.close();
  });
});
