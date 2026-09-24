// Starts two merod nodes, installs the bundle on each and exports the E2E_* env the fixtures read.
// Without merod or the bundle, node-backed specs skip locally but fail in CI, so CI cannot pass untested.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGIC_DIR = path.resolve(__dirname, '..', '..', 'logic');
const DATA_DIR = path.resolve(__dirname, '..', '.playwright-data'); // node homes + logs, uploaded by CI
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'adminadmin'; // throwaway, loopback only; merod enforces 8+ chars
// Ports no other app's e2e pins, so a node another suite left running is never mistaken for ours.
const NODES = [
  { name: 'drive-pw-1', serverPort: 2640, swarmPort: 2540 },
  { name: 'drive-pw-2', serverPort: 2641, swarmPort: 2541 },
];
// `--auth-storage memory` mints the admin from these at every start, so both init and run need them.
const NODE_ENV = {
  ...process.env,
  MERO_AUTH_ADMIN_USER: ADMIN_USER,
  MERO_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD,
};

function resolveMerod(): string | undefined {
  if (process.env.MEROD_BINARY) return process.env.MEROD_BINARY;
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v merod'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/** CI hands over the wasm job's bundle as KV_MPK_PATH; locally it is `pnpm logic:build`'s output. */
function resolveMpk(): string {
  if (process.env.KV_MPK_PATH) return process.env.KV_MPK_PATH;
  const cargoToml = readFileSync(path.join(LOGIC_DIR, 'Cargo.toml'), 'utf-8');
  const packageId = cargoToml.match(/^package\s*=\s*"([^"]+)"/m)?.[1];
  return path.join(LOGIC_DIR, 'dist', `${packageId}.mpk`);
}

async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/admin-api/health`)).ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`merod at ${url} never became healthy within ${timeoutMs}ms`);
}

async function api<T>(
  url: string,
  init: { token?: string; body: unknown },
): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: JSON.stringify(init.body),
  });
  if (!resp.ok)
    throw new Error(`POST ${url} -> ${resp.status}: ${await resp.text()}`);
  const parsed = await resp.json();
  return (parsed.data ?? parsed) as T;
}

function merodArgs(node: (typeof NODES)[number], ...args: string[]): string[] {
  return ['--home', DATA_DIR, '--node', node.name, ...args];
}

function initNodes(merod: string): void {
  for (const node of NODES) {
    execFileSync(
      merod,
      merodArgs(
        node,
        'init',
        '--server-port',
        String(node.serverPort),
        '--swarm-port',
        String(node.swarmPort),
        '--auth-mode',
        'embedded',
        '--auth-storage',
        'memory',
      ),
      { stdio: 'pipe', env: NODE_ENV },
    );
  }
  // Explicit bootstrap: mDNS alone does not reliably pair loopback nodes on macOS.
  const addrs = NODES.map((node) => {
    const config = readFileSync(
      path.join(DATA_DIR, node.name, 'config.toml'),
      'utf-8',
    );
    const peerId = config.match(/peer_id\s*=\s*"([^"]+)"/)?.[1];
    if (!peerId) throw new Error(`no peer_id in ${node.name}/config.toml`);
    return `"/ip4/127.0.0.1/udp/${node.swarmPort}/quic-v1/p2p/${peerId}"`;
  });
  NODES.forEach((node, i) => {
    const others = addrs.filter((_, j) => j !== i).join(',');
    execFileSync(
      merod,
      merodArgs(node, 'config', `bootstrap.nodes=[${others}]`),
      { stdio: 'pipe' },
    );
  });
}

async function startNode(
  merod: string,
  node: (typeof NODES)[number],
): Promise<number> {
  const url = `http://localhost:${node.serverPort}`;
  if (await healthy(url)) {
    throw new Error(
      `${url} already serves a merod that this run did not start; stop it first`,
    );
  }
  const proc = spawn(merod, merodArgs(node, 'run'), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: NODE_ENV,
  });
  const log = createWriteStream(path.join(DATA_DIR, `${node.name}.log`));
  proc.stdout?.pipe(log);
  proc.stderr?.pipe(log);
  return proc.pid!;
}

async function provision(url: string, mpk: string) {
  const tokens = await api<{ access_token: string; refresh_token: string }>(
    `${url}/auth/token`,
    {
      body: {
        auth_method: 'user_password',
        public_key: randomBytes(32).toString('base64'),
        client_name: 'mero-drive-e2e',
        timestamp: Date.now(),
        permissions: ['admin'],
        provider_data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
      },
    },
  );
  // `path` only: the route denies unknown fields.
  const { applicationId } = await api<{ applicationId: string }>(
    `${url}/admin-api/install-dev-application`,
    {
      token: tokens.access_token,
      body: { path: mpk },
    },
  );
  return {
    applicationId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

/** `scripts/local-rig.sh up` owns its nodes; this run only borrows their env. */
function loadRigEnv(): boolean {
  const envFile = path.resolve(__dirname, '..', '.env.integration');
  if (!existsSync(envFile)) return false;
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]] = match[2];
  }
  return true;
}

export default async function globalSetup(): Promise<(() => void) | undefined> {
  if (loadRigEnv()) {
    console.log('[setup] using the rig nodes from app/.env.integration');
    return undefined;
  }
  const merod = resolveMerod();
  const mpk = resolveMpk();
  if (!merod || !existsSync(mpk)) {
    const missing = merod
      ? `${mpk} (run pnpm logic:build)`
      : 'merod (set MEROD_BINARY)';
    if (process.env.CI) throw new Error(`node-backed e2e needs ${missing}`);
    console.log(
      `[setup] no ${missing}; single-node and two-node specs will skip`,
    );
    return undefined;
  }

  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const pids: number[] = [];
  const stop = () => {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };
  try {
    initNodes(merod);
    for (const node of NODES) pids.push(await startNode(merod, node));
    const urls = NODES.map((node) => `http://localhost:${node.serverPort}`);
    await Promise.all(urls.map((url) => waitForHealth(url)));
    // Sequential: concurrent installs of one .mpk path race inside merod.
    const [n1, n2] = [
      await provision(urls[0], mpk),
      await provision(urls[1], mpk),
    ];
    console.log(
      `[setup] ${NODES.length} nodes up, app ${n1.applicationId.slice(0, 8)} installed`,
    );

    Object.assign(process.env, {
      E2E_APPLICATION_ID: n1.applicationId,
      E2E_NODE_URL: urls[0],
      E2E_ACCESS_TOKEN: n1.accessToken,
      E2E_REFRESH_TOKEN: n1.refreshToken,
      E2E_NODE_URL_2: urls[1],
      E2E_ACCESS_TOKEN_2: n2.accessToken,
      E2E_REFRESH_TOKEN_2: n2.refreshToken,
    });
  } catch (err) {
    stop();
    throw err;
  }
  return stop;
}
