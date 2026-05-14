// Local orchestration helper that brings up a merobox stack
// (single-node by default, two-node with --two-node), mints JWTs for
// each node, discovers the installed application id, and writes
// app/.env.integration so `pnpm e2e:single` / `pnpm e2e:two-node`
// can run against a live stack.
//
// Mirror of the auth-bootstrap step in
// .github/workflows/integration-ci.yml. Differences from CI:
//   - assumes Docker daemon is already running locally
//   - skips re-building the mpk if logic/target hasn't changed
//   - uses the same workflow YAMLs (e2e/workflow-mero-drive-playwright-*-setup.yml)
//
// Usage:
//   pnpm e2e:up               # single-node
//   pnpm e2e:up:two-node      # two-node
//   pnpm e2e:down             # tear down

import { spawnSync, spawn, ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const E2E_DIR = resolve(REPO_ROOT, 'e2e');
const ENV_FILE = resolve(APP_DIR, '.env.integration');

const ADMIN_USER = process.env.E2E_ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? 'calimero1234';

const twoNode = process.argv.includes('--two-node');

const NODE_1_URL = 'http://node1.127.0.0.1.nip.io';
const NODE_2_URL = 'http://node2.127.0.0.1.nip.io';

const WORKFLOW = twoNode
  ? 'workflow-mero-drive-playwright-two-node-setup.yml'
  : 'workflow-mero-drive-playwright-fast-setup.yml';

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: opts.cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(
      `Command failed (exit ${result.status}): ${cmd} ${args.join(' ')}`,
    );
  }
}

function ensureMpkBuilt(): void {
  const mpk = resolve(REPO_ROOT, 'logic/dist/com.calimero.mero-drive-docs-9.1.0.mpk');
  if (existsSync(mpk)) {
    console.log(`mpk present: ${mpk}`);
    return;
  }
  console.log('mpk missing — building bundle…');
  run('pnpm', ['build:mpk'], { cwd: REPO_ROOT });
}

async function bootMerobox(): Promise<void> {
  // Pre-clean: a wedged previous run can poison the next one.
  spawnSync('merobox', ['stop', '--all'], { stdio: 'inherit' });
  spawnSync('merobox', ['nuke', '--force'], { stdio: 'inherit' });

  // merobox's CleanupMixin atexit handler tears containers down when
  // the python process exits, so we run it in the background and
  // SIGKILL it once the success line appears in stdout.
  const proc: ChildProcess = spawn('merobox', ['bootstrap', 'run', WORKFLOW], {
    cwd: E2E_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const target = 'Workflow completed successfully';

  await new Promise<void>((resolveP, rejectP) => {
    const onChunk = (buf: Buffer) => {
      const text = buf.toString();
      process.stdout.write(text);
      if (text.includes(target)) {
        console.log('\nmerobox setup workflow completed; SIGKILLing to skip atexit cleanup');
        proc.kill('SIGKILL');
        resolveP();
      }
    };
    proc.stdout!.on('data', onChunk);
    proc.stderr!.on('data', onChunk);
    proc.on('exit', (code, signal) => {
      if (signal === 'SIGKILL') return;
      rejectP(new Error(`merobox exited unexpectedly: code=${code}`));
    });
  });
}

async function waitForAuthProxy(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/auth/login`);
      if (r.status >= 200 && r.status < 300) {
        console.log(`auth proxy ready at ${url} (attempt ${i + 1})`);
        return;
      }
    } catch {
      /* node still booting */
    }
    await sleep(2000);
  }
  throw new Error(`auth proxy did not come up at ${url}`);
}

async function mintToken(nodeUrl: string): Promise<{ access: string; refresh: string }> {
  const res = await fetch(`${nodeUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_method: 'user_password',
      public_key: ADMIN_USER,
      client_name: 'mero-drive-e2e-up',
      timestamp: 0,
      permissions: [],
      provider_data: { username: ADMIN_USER, password: ADMIN_PASS },
    }),
  });
  const json = (await res.json()) as { data?: { access_token?: string; refresh_token?: string } };
  const access = json.data?.access_token;
  const refresh = json.data?.refresh_token;
  if (!access || !refresh) {
    throw new Error(`token mint failed for ${nodeUrl}: ${JSON.stringify(json)}`);
  }
  return { access, refresh };
}

async function discoverApplicationId(nodeUrl: string, token: string): Promise<string> {
  const res = await fetch(`${nodeUrl}/admin-api/applications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    data?: { apps?: Array<{ id: string }> };
  };
  const id = json.data?.apps?.[0]?.id;
  if (!id) throw new Error(`No application installed on ${nodeUrl}: ${JSON.stringify(json)}`);
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  ensureMpkBuilt();
  await bootMerobox();

  await waitForAuthProxy(NODE_1_URL);
  if (twoNode) await waitForAuthProxy(NODE_2_URL);

  const t1 = await mintToken(NODE_1_URL);
  const t2 = twoNode ? await mintToken(NODE_2_URL) : null;

  const appId = await discoverApplicationId(NODE_1_URL, t1.access);

  const lines = [
    `E2E_APPLICATION_ID=${appId}`,
    '',
    `E2E_NODE_URL=${NODE_1_URL}`,
    `E2E_ACCESS_TOKEN=${t1.access}`,
    `E2E_REFRESH_TOKEN=${t1.refresh}`,
  ];
  if (t2) {
    lines.push('');
    lines.push(`E2E_NODE_URL_2=${NODE_2_URL}`);
    lines.push(`E2E_ACCESS_TOKEN_2=${t2.access}`);
    lines.push(`E2E_REFRESH_TOKEN_2=${t2.refresh}`);
  }
  writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf-8');
  console.log(`\n.env.integration written: ${ENV_FILE}`);
  console.log(`\nRun: pnpm e2e:${twoNode ? 'two-node' : 'single'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
