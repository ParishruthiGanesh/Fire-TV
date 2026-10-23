/**
 * Record the browser half of the demo.
 *
 * One continuous session per surface, with timestamps written to marks.json so
 * the assembly step can cut scenes without re-staging anything. Nothing here is
 * faked: it drives the real UI against the real backend, at human speed.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? path.resolve('build/raw');
const BASE = 'http://localhost:5173';
const TOKEN = 'dev-caregiver-token';

fs.mkdirSync(OUT, { recursive: true });
const marks = [];
let t0 = 0;
const mark = (id) => {
  const at = (Date.now() - t0) / 1000;
  marks.push({ id, at });
  console.log(`  mark ${id} @ ${at.toFixed(2)}s`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, body) {
  const res = await fetch(`http://localhost:4000${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
  permissions: [],
});

const page = await context.newPage();
t0 = Date.now();
page.on('pageerror', (e) => console.error('PAGE ERROR', String(e)));

// ---- dashboard, before anything exists -----------------------------------
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
mark('02-dashboard');
await page.waitForTimeout(6000);

// ---- Anna describes the routine ------------------------------------------
await page.click('a[href="/builder"]');
await page.waitForSelector('textarea', { timeout: 15000 });
await page.waitForTimeout(1200);
mark('03-describe');

const DESCRIPTION =
  "Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the fridge. " +
  "Use this photo to show her which one. Ask if she wants preparation help. " +
  "If she says later, ask again in fifteen minutes.";
await page.click('textarea');
await page.type('textarea', DESCRIPTION, { delay: 14 });
await page.waitForTimeout(600);

// attach the reference photo the caregiver is talking about
const photo = path.resolve('../../demo-assets/yellow-container-in-fridge.png');
await page.setInputFiles('input[type=file]', photo);
await page.waitForTimeout(1800);
await page.click('button:has-text("Send")');

await page.waitForSelector('text=/preparation instructions/i', { timeout: 20000 });
await page.waitForTimeout(800);
mark('04-asks');
await page.waitForTimeout(5000);

// ---- Anna supplies the steps ---------------------------------------------
const STEPS =
  "Take the yellow container out of the fridge from the middle shelf. " +
  "Tip the oatmeal into a bowl and add milk up to the line. " +
  "Heat it in the microwave for two minutes, then give it a stir. " +
  "If the yellow container isn't there, there are oatmeal packets in the pantry on the second shelf.";
await page.click('textarea');
await page.type('textarea', STEPS, { delay: 11 });
await page.click('button:has-text("Send")');
await page.waitForSelector('text=/If something is different/i', { timeout: 20000 });
await page.waitForTimeout(1000);
mark('05-steps');
await page.waitForTimeout(6500);

// ---- a conversational edit, then publish ----------------------------------
await page.click('textarea');
await page.type('textarea', 'Make it eight thirty instead.', { delay: 28 });
await page.click('button:has-text("Send")');
await page.waitForSelector('text=8:30 AM', { timeout: 20000 });
await page.waitForTimeout(1500);
mark('06-publish');
await page.waitForTimeout(3000);
await page.click('button:has-text("Publish this routine")');
await page.waitForURL('**/', { timeout: 20000 });
await page.waitForTimeout(3500);
mark('06-published');
await page.waitForTimeout(2500);

await context.close();
await browser.close();

const videos = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
fs.writeFileSync(path.join(OUT, 'marks-caregiver.json'), JSON.stringify({ marks, videos }, null, 2));
console.log('\nvideos:', videos);
