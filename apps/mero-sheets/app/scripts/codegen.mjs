#!/usr/bin/env node
// Run calimero-abi-codegen for every service declared in studio.config.json.
// One ABI file per service crate, one generated client per service name.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '..');
const ROOT_DIR = resolve(APP_DIR, '..');
const CONFIG_PATH = resolve(ROOT_DIR, 'studio.config.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
if (!Array.isArray(config.services) || config.services.length === 0) {
  console.error('studio.config.json: services[] is empty or missing');
  process.exit(1);
}

const titleCase = (s) =>
  s.split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

for (const svc of config.services) {
  const name = svc.name;
  const clientName = `${titleCase(name)}Client`;
  // The monorepo promotes the PRIMARY service's crate to logic/ (a members-glob
  // match must be a package, so logic/Cargo.toml cannot be a nested workspace).
  // Probe the promoted layout first and fall back to the nested one.
  const promoted = resolve(ROOT_DIR, 'logic', 'res', 'abi.json');
  const nested = resolve(ROOT_DIR, 'logic', 'crates', name, 'res', 'abi.json');
  const abi = existsSync(promoted) && config.services.length === 1 ? promoted : nested;
  const out = resolve(APP_DIR, 'src', 'api', name);

  console.log(`[codegen] ${name} → ${clientName}`);
  const r = spawnSync(
    'calimero-abi-codegen',
    ['-i', abi, '-o', out, '--client-name', clientName],
    {
      stdio: 'inherit',
      shell: false,
      // Never let a wedged codegen binary hang forever. SIGKILL (not the
      // default SIGTERM) can't be ignored, so the call always returns and the
      // build can fail-fast + retry instead of stalling the whole pipeline.
      timeout: Number(process.env.CODEGEN_TIMEOUT_MS) || 120_000,
      killSignal: 'SIGKILL',
    },
  );
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') {
    console.error(`[codegen] ${name} TIMED OUT after ${Number(process.env.CODEGEN_TIMEOUT_MS) || 120_000}ms — killed`);
    process.exit(124);
  }
  if (r.status !== 0) {
    console.error(`[codegen] ${name} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}
