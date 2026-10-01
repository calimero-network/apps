#!/usr/bin/env node
// Resolve the .mpk path from studio.config.json and call the shared merod-install.sh.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '..');
const ROOT_DIR = resolve(APP_DIR, '..');
const FOUNDATION_DIR = resolve(ROOT_DIR, '..');
const config = JSON.parse(readFileSync(resolve(ROOT_DIR, 'studio.config.json'), 'utf8'));

const mpk = resolve(ROOT_DIR, 'logic', 'res', `${config.appName}-${config.appVersion}.mpk`);
const installer = resolve(FOUNDATION_DIR, 'scripts', 'merod-install.sh');

const r = spawnSync('bash', [installer, mpk, '.merod-data', '2'], { stdio: 'inherit', cwd: APP_DIR });
process.exit(r.status ?? 1);
