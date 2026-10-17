/**
 * Playwright global teardown: stops all merod nodes, cleans up data.
 */
import { existsSync, readFileSync } from 'fs';
import { removeDataDir, stopNodes } from '@calimero-apps/e2e-node';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '.playwright-data');
const STATE_FILE = path.resolve(DATA_DIR, 'pw-state.json');

export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) return;

  let pids: number[] = [];
  try {
    pids = JSON.parse(readFileSync(STATE_FILE, 'utf-8')).pids || [];
  } catch { /* state file corrupted */ }
  for (const pid of pids) console.log(`Stopping merod (PID ${pid})...`);
  await stopNodes(pids);

  // Only wipe data when we spawned nodes ourselves. Leave reused dev nodes alone.
  // Set KEEP_DATA=1 to preserve logs/config for debugging.
  if (pids.length && existsSync(DATA_DIR) && !process.env['KEEP_DATA']) {
    removeDataDir(DATA_DIR);
    console.log('All nodes stopped, data cleaned');
  } else {
    console.log('Leaving data dir intact');
  }
}
