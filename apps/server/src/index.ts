import { WebSocketServer } from 'ws';
import { env } from './env.js';
import { getDb } from './db.js';
import { createApp } from './app.js';

const { app, scheduler, ai, store, hub } = createApp(getDb());

scheduler.start();

const server = app.listen(env.port, env.host, () => {
  const household = store.firstHousehold();
  console.log(`\nAlongside backend listening on http://${env.host}:${env.port}`);
  console.log(`  AI provider      ${ai.status().active}${ai.status().offline ? ' (no credentials needed)' : ''}`);
  console.log(`  Database         ${env.dbPath}`);
  console.log(`  MCP endpoint     http://${env.host}:${env.port}/mcp  (Streamable HTTP, spec 2025-11-25)`);
  console.log(`  TV WebSocket     ws://${env.host}:${env.port}/ws?token=<device token>`);
  if (household) {
    console.log(`  Household        ${household.name} — pairing code ${household.pairingCode}`);
  } else {
    console.log('  No household yet. Run: npm run seed -w @alongside/server');
  }
  console.log('');
});

/**
 * WebSocket fan-out for clients without EventSource (the Fire TV app).
 *
 * The token travels as a query parameter because React Native's WebSocket
 * cannot set request headers; it is the same household-scoped device token the
 * REST API checks, and the connection is refused without a valid one.
 */
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/ws', 'http://localhost');
  const auth = store.authenticate(url.searchParams.get('token') ?? undefined);
  if (!auth) {
    socket.send(JSON.stringify({ type: 'error', message: 'unauthorised' }));
    socket.close(4401, 'unauthorised');
    return;
  }
  const unsubscribe = hub.subscribeSocket(auth.householdId, socket);
  socket.send(JSON.stringify({ type: 'snapshot', snapshot: store.snapshot(auth.householdId) }));
  const keepAlive = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping', now: new Date().toISOString() }));
    }
  }, 20_000);
  keepAlive.unref?.();
  socket.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
  socket.on('error', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down.`);
  scheduler.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
