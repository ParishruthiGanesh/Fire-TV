import path from 'node:path';
import { writeDemoAssets } from './demo-assets.js';

/** Write the generated demo artwork to ./demo-assets for inspection. */
const target = process.argv[2] ?? path.resolve(process.cwd(), '../../demo-assets');
const written = writeDemoAssets(target);
console.log(`Wrote ${written.length} demo images to ${target}`);
for (const file of written) console.log(`  ${path.basename(file)}`);
