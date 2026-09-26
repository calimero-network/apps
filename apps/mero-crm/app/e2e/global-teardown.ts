/**
 * Playwright global teardown: stops all merod nodes, cleans up data.
 */
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '.playwright-data');
const STATE_FILE = path.resolve(DATA_DIR, 'pw-state.json');

export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) return;

  let spawnedAny = false;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    for (const pid of state.pids || []) {
      spawnedAny = true;
      console.log(`Stopping merod (PID ${pid})...`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch { /* already dead */ }
    }
    if (spawnedAny) await new Promise((r) => setTimeout(r, 2000));
  } catch { /* state file corrupted */ }

  // Only wipe data when we spawned nodes ourselves. Leave reused dev nodes alone.
  // Set KEEP_DATA=1 to preserve logs/config for debugging.
  if (spawnedAny && existsSync(DATA_DIR) && !process.env['KEEP_DATA']) {
    execSync(`rm -rf "${DATA_DIR}"`);
    console.log('All nodes stopped, data cleaned');
  } else {
    console.log('Leaving data dir intact');
  }
}
