import fs from 'node:fs';
import path from 'node:path';
import { Bitmap } from './png.js';

/**
 * Generated reference artwork for the demo household.
 *
 * These stand in for the photos a real caregiver would upload. They are drawn
 * here so the repository carries no third-party imagery, and every one is
 * stamped "DEMO" so nobody mistakes them for a real person's kitchen. Replace
 * them with real photographs through the dashboard's upload control.
 */

const CREAM: [number, number, number] = [250, 246, 240];
const NAVY: [number, number, number] = [19, 37, 64];
const TEAL: [number, number, number] = [58, 125, 124];
const AMBER: [number, number, number] = [214, 143, 44];
const YELLOW: [number, number, number] = [235, 190, 70];
const WHITE: [number, number, number] = [255, 255, 255];
const GREY: [number, number, number] = [205, 205, 200];
const FRIDGE: [number, number, number] = [226, 230, 233];

export interface DemoAsset {
  key: string;
  filename: string;
  caption: string;
  png: Buffer;
}

const W = 960;
const H = 540;

function base(label: string): Bitmap {
  const bmp = new Bitmap(W, H, CREAM);
  bmp.fill(0, 0, W, 64, NAVY);
  bmp.text(24, 24, label, 3, CREAM);
  bmp.fill(0, H - 44, W, 44, [238, 232, 223]);
  bmp.text(24, H - 32, 'DEMO REFERENCE IMAGE - REPLACE WITH A REAL PHOTO', 2, NAVY);
  return bmp;
}

function fridgeScene(highlightShelf: number): Bitmap {
  const bmp = base('IN THE FRIDGE');
  bmp.roundedRect(220, 96, 520, 390, 24, FRIDGE);
  bmp.roundedRect(236, 112, 488, 358, 16, WHITE);
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const y = 160 + shelf * 108;
    bmp.fill(248, y + 78, 464, 6, GREY);
    if (shelf === highlightShelf) {
      bmp.roundedRect(286, y, 150, 74, 10, YELLOW);
      bmp.roundedRect(298, y + 10, 126, 16, 6, [250, 230, 160]);
      bmp.fill(286, y + 68, 150, 6, AMBER);
    } else {
      bmp.roundedRect(286, y + 14, 110, 60, 8, [214, 222, 228]);
      bmp.roundedRect(430, y + 24, 70, 50, 8, [200, 214, 206]);
    }
  }
  bmp.fill(724, 230, 12, 110, GREY);
  return bmp;
}

export function buildDemoAssets(): DemoAsset[] {
  const assets: DemoAsset[] = [];

  // Mary's portrait placeholder — a calm abstract figure, never a real person.
  {
    const bmp = base('MARY');
    bmp.circle(480, 250, 150, [236, 226, 214]);
    bmp.circle(480, 210, 74, [224, 206, 188]);
    bmp.roundedRect(392, 290, 176, 130, 40, TEAL);
    bmp.text(300, 452, 'PROFILE PHOTO PLACEHOLDER', 2, NAVY);
    assets.push({
      key: 'mary-portrait',
      filename: 'mary-portrait.png',
      caption: 'Profile photo placeholder for Mary (demo content)',
      png: bmp.toPng(),
    });
  }

  // The yellow container, on the middle shelf.
  {
    const bmp = fridgeScene(1);
    bmp.text(300, 500 - 440, '', 2, NAVY);
    bmp.text(250, 70 + 14, '', 2, NAVY);
    bmp.text(286, 150, 'YELLOW CONTAINER', 2, NAVY);
    assets.push({
      key: 'yellow-container',
      filename: 'yellow-container-in-fridge.png',
      caption: 'The yellow container on the middle shelf of the fridge (demo content)',
      png: bmp.toPng(),
    });
  }

  // Pantry alternative.
  {
    const bmp = base('PANTRY - SECOND SHELF');
    bmp.roundedRect(200, 100, 560, 380, 18, [233, 222, 206]);
    for (let shelf = 0; shelf < 3; shelf += 1) {
      const y = 140 + shelf * 116;
      bmp.fill(216, y + 92, 528, 8, [196, 180, 160]);
      if (shelf === 1) {
        for (let i = 0; i < 4; i += 1) {
          bmp.roundedRect(260 + i * 110, y + 24, 84, 68, 8, AMBER);
          bmp.fill(260 + i * 110, y + 40, 84, 10, [240, 214, 170]);
        }
        bmp.text(258, y + 4, 'OATMEAL PACKETS', 2, NAVY);
      } else {
        bmp.roundedRect(280, y + 32, 90, 60, 8, [214, 206, 192]);
        bmp.roundedRect(420, y + 42, 70, 50, 8, [206, 214, 200]);
      }
    }
    assets.push({
      key: 'pantry-packets',
      filename: 'oatmeal-packets-pantry.png',
      caption: 'Oatmeal packets on the second shelf of the pantry (demo content)',
      png: bmp.toPng(),
    });
  }

  // Microwave.
  {
    const bmp = base('MICROWAVE - 2 MINUTES');
    bmp.roundedRect(180, 110, 600, 320, 20, [60, 66, 74]);
    bmp.roundedRect(210, 140, 380, 260, 12, [24, 28, 34]);
    bmp.roundedRect(240, 170, 320, 200, 10, [40, 46, 54]);
    bmp.circle(400, 300, 54, [120, 128, 138]);
    bmp.roundedRect(620, 150, 130, 70, 8, [226, 230, 233]);
    bmp.text(632, 172, '2:00', 3, NAVY);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        bmp.roundedRect(624 + col * 42, 250 + row * 42, 32, 32, 6, [150, 158, 166]);
      }
    }
    bmp.roundedRect(620, 380, 130, 34, 8, AMBER);
    assets.push({
      key: 'microwave',
      filename: 'microwave-two-minutes.png',
      caption: 'The microwave set to two minutes (demo content)',
      png: bmp.toPng(),
    });
  }

  // Finished bowl.
  {
    const bmp = base('READY TO EAT');
    bmp.circle(480, 300, 160, [226, 222, 214]);
    bmp.circle(480, 300, 132, WHITE);
    bmp.circle(480, 300, 104, [232, 206, 160]);
    bmp.circle(440, 280, 16, [196, 160, 110]);
    bmp.circle(508, 318, 14, [196, 160, 110]);
    bmp.roundedRect(640, 250, 24, 150, 10, [180, 186, 190]);
    bmp.circle(652, 240, 22, [180, 186, 190]);
    assets.push({
      key: 'ready-bowl',
      filename: 'ready-to-eat-bowl.png',
      caption: 'The finished bowl, ready to eat (demo content)',
      png: bmp.toPng(),
    });
  }

  // Clothes laid out for getting ready.
  {
    const bmp = base('CLOTHES ON THE CHAIR');
    bmp.roundedRect(180, 130, 280, 300, 16, [92, 124, 148]);
    bmp.roundedRect(210, 160, 220, 80, 12, [120, 152, 176]);
    bmp.roundedRect(500, 130, 280, 300, 16, [168, 142, 120]);
    bmp.roundedRect(530, 300, 220, 110, 12, [188, 164, 142]);
    bmp.text(200, 452, 'TOP ON THE LEFT, TROUSERS ON THE RIGHT', 2, NAVY);
    assets.push({
      key: 'clothes-chair',
      filename: 'clothes-on-the-chair.png',
      caption: 'Clothes laid out on the bedroom chair (demo content)',
      png: bmp.toPng(),
    });
  }

  // Glasses on the bedside table — the approved alternative for "can't find".
  {
    const bmp = base('GLASSES - BEDSIDE TABLE');
    bmp.roundedRect(240, 230, 480, 200, 16, [196, 170, 142]);
    bmp.fill(280, 430, 40, 70, [170, 146, 120]);
    bmp.fill(640, 430, 40, 70, [170, 146, 120]);
    bmp.circle(420, 300, 52, [238, 238, 240]);
    bmp.circle(420, 300, 40, CREAM);
    bmp.circle(540, 300, 52, [238, 238, 240]);
    bmp.circle(540, 300, 40, CREAM);
    bmp.fill(472, 294, 36, 10, [120, 126, 134]);
    assets.push({
      key: 'glasses-bedside',
      filename: 'glasses-on-bedside-table.png',
      caption: 'Reading glasses on the bedside table (demo content)',
      png: bmp.toPng(),
    });
  }

  // Family call.
  {
    const bmp = base('CALL WITH ANNA');
    bmp.roundedRect(260, 120, 440, 300, 20, NAVY);
    bmp.roundedRect(284, 144, 392, 252, 14, [46, 70, 104]);
    bmp.circle(480, 240, 62, [236, 226, 214]);
    bmp.roundedRect(410, 300, 140, 80, 28, TEAL);
    bmp.roundedRect(400, 440, 160, 48, 14, AMBER);
    bmp.text(420, 454, 'ANSWER', 2, NAVY);
    assets.push({
      key: 'family-call',
      filename: 'family-call.png',
      caption: 'The video call screen for the Sunday family call (demo content)',
      png: bmp.toPng(),
    });
  }

  // Doorbell snapshot placeholder for the optional Ring simulation.
  {
    const bmp = base('FRONT DOOR (SIMULATED)');
    bmp.roundedRect(300, 110, 360, 330, 14, [206, 196, 182]);
    bmp.roundedRect(330, 140, 300, 270, 10, [182, 170, 156]);
    bmp.circle(610, 280, 14, AMBER);
    bmp.roundedRect(690, 240, 44, 70, 12, [70, 76, 84]);
    bmp.circle(712, 262, 12, [150, 190, 220]);
    bmp.text(250, 470, 'SIMULATOR EVENT - NOT A REAL RING DEVICE', 2, NAVY);
    assets.push({
      key: 'front-door',
      filename: 'front-door-simulated.png',
      caption: 'Placeholder for a simulated doorbell event (demo content)',
      png: bmp.toPng(),
    });
  }

  return assets;
}

/** Write the generated artwork into a directory, for inspection or re-use. */
export function writeDemoAssets(targetDir: string): string[] {
  fs.mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];
  for (const asset of buildDemoAssets()) {
    const file = path.join(targetDir, asset.filename);
    fs.writeFileSync(file, asset.png);
    written.push(file);
  }
  return written;
}
