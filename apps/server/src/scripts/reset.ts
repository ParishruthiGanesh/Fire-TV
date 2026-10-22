import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';

/** Delete the database and uploads so `npm run seed` starts clean. */
function main(): void {
  for (const file of [env.dbPath, `${env.dbPath}-wal`, `${env.dbPath}-shm`]) {
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      console.log(`removed ${file}`);
    }
  }
  if (fs.existsSync(env.uploadDir)) {
    for (const entry of fs.readdirSync(env.uploadDir)) {
      fs.rmSync(path.join(env.uploadDir, entry), { force: true, recursive: true });
    }
    console.log(`emptied ${env.uploadDir}`);
  }
  console.log('\nReset complete. Run "npm run seed -w @alongside/server" to recreate the demo household.');
}

main();
