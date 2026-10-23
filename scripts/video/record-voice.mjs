/**
 * Record Mary's half: the voice client, and the dashboard reacting to it.
 *
 * Typed rather than spoken, because a headless browser has no microphone —
 * the typed path goes through the identical backend call, so the state changes
 * on screen are the real ones.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? path.resolve('build/raw');
const BASE = 'http://localhost:5173';
const TOKEN = 'dev-caregiver-token';
fs.mkdirSync(OUT, { recursive: true });

const api = async (p, body) => {
  const r = await fetch(`http://localhost:4000${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`);
  return r.json();
};

const code = (await api('/api/household')).pairingCode;
console.log('pairing code', code);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ---------------------------------------------------------------- voice page
const voiceCtx = await browser.newContext({
  viewport: { width: 1600, height: 813 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 813 } },
});
const voice = await voiceCtx.newPage();
const vMarks = [];
let vt0 = 0;
const vMark = (id) => {
  const at = (Date.now() - vt0) / 1000;
  vMarks.push({ id, at });
  console.log(`  voice ${id} @ ${at.toFixed(2)}s`);
};

await voice.goto(`${BASE}/voice`, { waitUntil: 'domcontentloaded' });
vt0 = Date.now();
await voice.waitForTimeout(1500);
await voice.fill('input[placeholder="ABC123"]', code);
await voice.click('button:has-text("Pair this device")');
await voice.waitForSelector('text=Alexa+ experience simulation', { timeout: 15000 });
await voice.waitForTimeout(2500);

const say = async (text, mark, settle = 4200) => {
  await voice.fill('input[placeholder="Or type what you would say"]', '');
  await voice.type('input[placeholder="Or type what you would say"]', text, { delay: 26 });
  await voice.waitForTimeout(400);
  if (mark) vMark(mark);
  await voice.click('button:has-text("Send")');
  await voice.waitForTimeout(settle);
};

await say('Yes. What am I having?', '08-ask', 6500);
await say('Help me with the next step.', null, 5000);
await say('Give me fifteen minutes.', '09-postpone', 6000);
await voice.waitForTimeout(1500);
await say("The container isn't there.", null, 6000);
await say('I need help.', '12-help', 6000);
vMark('12-help-end');
await voiceCtx.close();

// ------------------------------------------------- dashboard sees the request
const dashCtx = await browser.newContext({
  viewport: { width: 1600, height: 813 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 813 } },
});
const dash = await dashCtx.newPage();
const dMarks = [];
let dt0 = 0;
const dMark = (id) => {
  const at = (Date.now() - dt0) / 1000;
  dMarks.push({ id, at });
  console.log(`  dash ${id} @ ${at.toFixed(2)}s`);
};
await dash.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
dt0 = Date.now();
await dash.waitForSelector('text=Help requested', { timeout: 20000 });
await dash.waitForTimeout(1500);
dMark('12-help');
await dash.waitForTimeout(5500);
await dash.click('button:has-text("Acknowledge")');
await dash.waitForTimeout(3000);

// Mary reports she has eaten; the dashboard is watching when it lands.
const snapshot = await api('/api/snapshot');
await api('/api/assistant/turn', {
  text: 'I already ate', occurrenceId: snapshot.focusOccurrenceId, surface: 'voice',
});
await dash.waitForTimeout(2500);
dMark('13-final');
await dash.waitForTimeout(7000);

await dashCtx.close();
await browser.close();

fs.writeFileSync(path.join(OUT, 'marks-voice.json'), JSON.stringify({ vMarks, dMarks }, null, 2));
console.log('done');
