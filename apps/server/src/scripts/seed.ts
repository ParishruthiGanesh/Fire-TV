import fs from 'node:fs';
import path from 'node:path';
import { env, ensureDirs } from '../env.js';
import { openDb } from '../db.js';
import { id } from '../ids.js';
import { Store } from '../store.js';
import { buildDemoAssets } from './demo-assets.js';
import { addLocalDays, localDateInZone, type DraftRoutine, type WeekdayKey } from '@alongside/shared';

/**
 * Seed the fictional demo household.
 *
 * Mary lives alone; Anna is her daughter. Two routines are published so the
 * product looks like it has been in use, and breakfast is deliberately left
 * out: the demo starts with Anna describing it, which is the whole point of
 * the conversational builder. Pass --with-breakfast to seed that too.
 */

const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const EVERY_DAY: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const TIMEZONE = process.env.ALONGSIDE_DEMO_TIMEZONE ?? 'America/New_York';

function main(): void {
  const withBreakfast = process.argv.includes('--with-breakfast');
  ensureDirs();
  const db = openDb();
  const store = new Store(db);

  const existing = store.firstHousehold();
  if (existing) {
    console.log(`A household already exists (${existing.name}). Run "npm run reset" first to reseed.`);
    return;
  }

  const { household, caregiver } = store.createHousehold({
    name: 'The Whitaker household',
    timezone: TIMEZONE,
    caregiverName: 'Anna',
    caregiverEmail: 'anna@example.com',
    caregiverToken: env.caregiverToken,
    profile: {
      preferredName: 'Mary',
      fullName: 'Mary Whitaker',
      language: 'en-US',
      notes:
        'Mary lives on her own and prefers to do things herself. She keeps her reading glasses by the bed. ' +
        'Demo profile — not a real person.',
    },
  });

  // ---- reference media
  const assetIds = new Map<string, string>();
  for (const asset of buildDemoAssets()) {
    const storedName = `${id('demo')}.png`;
    fs.writeFileSync(path.join(env.uploadDir, storedName), asset.png);
    const created = store.addMediaAsset({
      householdId: household.id,
      kind: 'image',
      filename: asset.filename,
      storedName,
      mime: 'image/png',
      bytes: asset.png.length,
      caption: asset.caption,
      isDemo: true,
    });
    assetIds.set(asset.key, created.id);
  }
  store.updateProfile(household.id, { photoAssetId: assetIds.get('mary-portrait') ?? null });

  const publish = (routine: DraftRoutine, transcript: string) => {
    const draft = store.createDraft({
      householdId: household.id,
      routine,
      missing: [],
      sourceTurns: [
        { role: 'caregiver', text: transcript, createdAt: new Date().toISOString() },
        {
          role: 'assistant',
          text: 'I put this together from what you told me. Have a look before publishing.',
          createdAt: new Date().toISOString(),
        },
      ],
      mediaAssetIds: [],
      voiceNoteAssetId: null,
      aiProvider: 'seed',
    });
    return store.publishDraft(household.id, draft.id);
  };

  // ---- getting ready
  publish(
    {
      title: 'Getting ready',
      days: WEEKDAYS,
      localTime: '09:00',
      timezone: TIMEZONE,
      instructions: 'Mary lays her clothes on the bedroom chair the night before. Her reading glasses live on the bedside table.',
      greeting: "It's time to get ready for the day.",
      steps: [
        {
          title: 'Wash and brush',
          body: 'Have a wash and brush your teeth. Everything is on the shelf above the sink.',
          mediaAssetId: null,
        },
        {
          title: 'Clothes on the chair',
          body: 'Your clothes are on the bedroom chair — the top is on the left and the trousers are on the right.',
          mediaAssetId: assetIds.get('clothes-chair') ?? null,
        },
        {
          title: 'Reading glasses',
          body: 'Pick up your reading glasses from the bedside table before you come through.',
          mediaAssetId: assetIds.get('glasses-bedside') ?? null,
        },
      ],
      alternatives: [
        {
          situation: "she can't find her reading glasses",
          response: 'Your reading glasses are usually on the bedside table, next to the lamp.',
          mediaAssetId: assetIds.get('glasses-bedside') ?? null,
        },
      ],
      heroMediaAssetId: assetIds.get('clothes-chair') ?? null,
      followUpMinutes: 20,
      helpPolicy: 'If Mary asks for help getting dressed, let me know and I will ring her.',
      oneOff: null,
    },
    'Mum gets ready around nine on weekdays. Her clothes are on the bedroom chair and her glasses are on the bedside table. If she cannot find her glasses, they are usually on the bedside table next to the lamp.',
  );

  // ---- family call
  publish(
    {
      title: 'Family call',
      days: EVERY_DAY,
      localTime: '16:30',
      timezone: TIMEZONE,
      instructions: 'Anna calls in the late afternoon. The call comes through on the television.',
      greeting: "Anna's call is coming up.",
      steps: [
        {
          title: 'Settle in the armchair',
          body: 'Settle into the armchair by the window so you are comfortable for the call.',
          mediaAssetId: null,
        },
        {
          title: 'Answer the call',
          body: 'When the call appears on the television, choose the amber Answer button with the remote.',
          mediaAssetId: assetIds.get('family-call') ?? null,
        },
      ],
      alternatives: [],
      heroMediaAssetId: assetIds.get('family-call') ?? null,
      followUpMinutes: 10,
      helpPolicy: 'If the call does not come through, raise a help request and I will call the landline.',
      oneOff: null,
    },
    'I call Mum in the late afternoon, about half four. The call shows up on her television and she just has to pick the amber answer button.',
  );

  // ---- optional: the breakfast routine the demo normally creates live
  if (withBreakfast) {
    publish(
      {
        title: 'Breakfast',
        days: WEEKDAYS,
        localTime: '08:00',
        timezone: TIMEZONE,
        instructions: 'Mary\'s oatmeal is in the yellow container on the middle shelf of the fridge.',
        greeting: "It's breakfast time.",
        steps: [
          {
            title: 'Take out the container',
            body: 'Take the yellow container out of the fridge — it is on the middle shelf.',
            mediaAssetId: assetIds.get('yellow-container') ?? null,
          },
          {
            title: 'Add milk and heat',
            body: 'Tip the oatmeal into a bowl, add milk up to the line, and heat it in the microwave for two minutes.',
            mediaAssetId: assetIds.get('microwave') ?? null,
          },
          {
            title: 'Stir and eat',
            body: 'Give it a stir and let it stand for a minute before you eat it.',
            mediaAssetId: assetIds.get('ready-bowl') ?? null,
          },
        ],
        alternatives: [
          {
            situation: 'the yellow container is not in the fridge',
            response: 'There are oatmeal packets in the pantry, on the second shelf. One packet with milk works just the same.',
            mediaAssetId: assetIds.get('pantry-packets') ?? null,
          },
        ],
        heroMediaAssetId: assetIds.get('yellow-container') ?? null,
        followUpMinutes: 15,
        helpPolicy: 'If Mary asks for help with breakfast, let me know and I will talk her through it.',
        oneOff: null,
      },
      'Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the fridge.',
    );
  }

  // ---- a little history, so the dashboard is not empty on first open
  const today = localDateInZone(new Date(), TIMEZONE);
  const yesterday = addLocalDays(today, -1);
  const backdate = (hhmm: string) => `${yesterday}T${hhmm}:00.000Z`;
  const history: Array<[string, string, string]> = [
    ['occurrence_due', 'Getting ready is due', '13:00'],
    ['occurrence_started', 'Getting ready started', '13:04'],
    ['step_confirmed', 'Getting ready: step 1 confirmed', '13:07'],
    ['occurrence_completed', 'Getting ready completed (self-reported)', '13:19'],
    ['occurrence_due', 'Family call is due', '20:30'],
    ['occurrence_completed', 'Family call completed (self-reported)', '20:58'],
  ];
  for (const [type, summary, hhmm] of history) {
    db.prepare(
      `INSERT INTO activity_events (id, household_id, type, summary, occurrence_id, surface, detail_json, created_at)
       VALUES (?,?,?,?,NULL,'system',NULL,?)`,
    ).run(id('ev'), household.id, type, summary, backdate(hhmm));
  }

  console.log('Seeded the demo household.\n');
  console.log(`  Household      ${household.name} (${household.timezone})`);
  console.log(`  Older adult    Mary Whitaker — preferred name "Mary"`);
  console.log(`  Caregiver      ${caregiver.name}`);
  console.log(`  Pairing code   ${household.pairingCode}   <- enter this on the TV and the voice client`);
  console.log(`  Caregiver token ${env.caregiverToken}`);
  console.log(`  Routines       ${store.listRoutines(household.id).map((r) => r.title).join(', ')}`);
  console.log(`  Demo images    ${assetIds.size} generated reference images`);
  if (!withBreakfast) {
    console.log('\n  Breakfast was left out on purpose — build it live in the dashboard,');
    console.log('  or re-seed with: npm run seed -- --with-breakfast');
  }
}

main();
