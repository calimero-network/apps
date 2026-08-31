/**
 * Playwright global setup: starts 3 merod nodes with embedded auth,
 * authenticates each, installs the app bundle on each.
 */
import { execSync, execFileSync, spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Portable merod resolution: $MEROD_BINARY → PATH → common locations.
// No hard-coded personal path so this file works verbatim in generated
// apps, CI, and on any dev machine (it is materialized, not patched).
function resolveMerodBinary(): string {
  const fromEnv = process.env['MEROD_BINARY'];
  if (fromEnv) return fromEnv;
  try {
    const onPath = execSync('command -v merod', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (onPath) return onPath;
  } catch { /* not on PATH */ }
  const home = process.env['HOME'] || '';
  for (const c of [
    '/usr/local/bin/merod',
    '/usr/bin/merod',
    home && path.join(home, 'bin', 'merod'),
    // Last-resort local dev convenience (calimero monorepo checkout).
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'core', 'target', 'release', 'merod'),
  ]) {
    if (c && existsSync(c)) return c;
  }
  return 'merod'; // let the spawn fail loudly if truly absent
}

// In the monorepo CI, the Browser E2E job downloads the mpk-<app>-<sha> artifact
// and exports its path as KV_MPK_PATH (a generic-but-kv-named env every app's
// setup reads — see apps/kv-store). Honour it first; fall back to the local
// build-bundle.sh output for `pnpm test:e2e` on a dev machine.
function resolveMpkPath(): string {
  const fromEnv = process.env['KV_MPK_PATH'];
  if (fromEnv) return fromEnv;
  const cfgPath = path.resolve(__dirname, '..', '..', 'studio.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  return path.resolve(
    __dirname, '..', '..', 'logic', 'res',
    `${cfg.appName}-${cfg.appVersion}.mpk`,
  );
}

const MEROD_BINARY = resolveMerodBinary();
const DATA_DIR = path.resolve(__dirname, '..', '.playwright-data');
const MPK_PATH = resolveMpkPath();
const STATE_FILE = path.resolve(DATA_DIR, 'pw-state.json');

const ALL_NODES = [
  { name: 'pw-node-1', serverPort: 2428, swarmPort: 2528 },
  { name: 'pw-node-2', serverPort: 2429, swarmPort: 2529 },
  { name: 'pw-node-3', serverPort: 2430, swarmPort: 2530 },
];

const NODE_COUNT = Math.max(1, Math.min(3, Number(process.env['NODE_COUNT']) || 3));
const NODES = ALL_NODES.slice(0, NODE_COUNT);

async function waitForHealth(url: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`${url}/admin-api/health`);
      if (resp.ok) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`merod not healthy after ${timeoutMs}ms`);
}

async function authenticate(adminUrl: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const keypair = nacl.sign.keyPair();
  const publicKeyBase58 = Buffer.from(keypair.publicKey).toString('base64');

  const resp = await fetch(`${adminUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_method: 'user_password',
      public_key: publicKeyBase58,
      client_name: 'playwright-e2e',
      timestamp: Date.now(),
      permissions: ['context:create', 'context:list', 'context:execute', 'admin:*'],
      provider_data: { username: 'admin', password: 'admin' },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Auth failed (${resp.status}): ${await resp.text()}`);
  }

  const data = await resp.json();
  const t = data.data || data;
  return { accessToken: t.access_token, refreshToken: t.refresh_token };
}

async function installBundle(adminUrl: string, token: string): Promise<string> {
  const resp = await fetch(`${adminUrl}/admin-api/install-dev-application`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ path: MPK_PATH, metadata: [] }),
  });
  if (!resp.ok) throw new Error(`Install failed: ${await resp.text()}`);
  const data = await resp.json();
  return data.data.applicationId;
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/admin-api/health`);
    return resp.ok;
  } catch {
    return false;
  }
}

function initNode(node: typeof NODES[0]): void {
  execSync(
    `"${MEROD_BINARY}" --home "${DATA_DIR}" --node "${node.name}" init ` +
    `--server-port ${node.serverPort} --swarm-port ${node.swarmPort} ` +
    `--auth-mode embedded`,
    { stdio: 'pipe' },
  );
  execSync(
    `"${MEROD_BINARY}" --home "${DATA_DIR}" --node "${node.name}" ` +
    `config "discovery.mdns=true"`,
    { stdio: 'pipe' },
  );
}

function readPeerId(node: typeof NODES[0]): string {
  const configPath = path.join(DATA_DIR, node.name, 'config.toml');
  const content = readFileSync(configPath, 'utf-8');
  const m = content.match(/peer_id\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`Could not read peer_id for ${node.name}`);
  return m[1];
}

function applyBootstrap(node: typeof NODES[0], otherAddrs: string[]): void {
  // bootstrap.nodes wants a TOML array literal. Use execFileSync to avoid
  // shell quoting issues with embedded double quotes around each addr.
  const value = '[' + otherAddrs.map((a) => `"${a}"`).join(',') + ']';
  execFileSync(MEROD_BINARY, [
    '--home', DATA_DIR,
    '--node', node.name,
    'config', `bootstrap.nodes=${value}`,
  ], { stdio: 'pipe' });
}

function runNode(node: typeof NODES[0]): ChildProcess {
  const proc = spawn(MEROD_BINARY, ['--home', DATA_DIR, '--node', node.name, 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const logFile = path.join(DATA_DIR, `${node.name}.log`);
  const logStream = createWriteStream(logFile);
  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);
  return proc;
}

export default async function globalSetup() {
  if (!existsSync(MEROD_BINARY)) {
    throw new Error(`merod not found at ${MEROD_BINARY}. Set MEROD_BINARY env var.`);
  }
  if (!existsSync(MPK_PATH)) {
    throw new Error(`p2p-sheets .mpk not found at ${MPK_PATH}. In CI it arrives as the mpk-p2p-sheets artifact via KV_MPK_PATH; locally run: cd logic && ./build-bundle.sh`);
  }

  // Check if nodes are already running (dev mode) — reuse them.
  const existing = await Promise.all(
    NODES.map((node) => isHealthy(`http://localhost:${node.serverPort}`)),
  );
  const reuseAll = existing.every(Boolean);

  if (reuseAll) {
    console.log('Reusing existing healthy nodes');
    mkdirSync(DATA_DIR, { recursive: true });
  } else {
    if (existsSync(DATA_DIR)) execSync(`rm -rf "${DATA_DIR}"`);
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const pids: number[] = [];

  if (!reuseAll) {
    // Init all nodes first so config.toml exists with peer IDs.
    for (const node of NODES) initNode(node);

    // Cross-wire bootstrap so peers discover each other on local loopback.
    // mDNS alone is unreliable on macOS; explicit bootstrap is what merobox
    // does for binary-mode multi-node tests.
    if (NODES.length > 1) {
      const peerIds = NODES.map(readPeerId);
      const swarmAddr = (peerId: string, swarmPort: number) =>
        `/ip4/127.0.0.1/udp/${swarmPort}/quic-v1/p2p/${peerId}`;
      NODES.forEach((node, i) => {
        const others = NODES
          .map((n, j) => ({ n, j }))
          .filter(({ j }) => j !== i)
          .map(({ n, j }) => swarmAddr(peerIds[j], n.swarmPort));
        applyBootstrap(node, others);
      });
      console.log(`Bootstrap configured for ${NODES.length} nodes`);
    }

    // Start nodes (process spawn is fast; health check waits for readiness).
    for (const node of NODES) {
      const proc = runNode(node);
      pids.push(proc.pid!);
      console.log(`${node.name} started (PID ${proc.pid})`);
    }
  }

  const readyNodes = await Promise.all(
    NODES.map(async (node) => {
      const url = `http://localhost:${node.serverPort}`;
      await waitForHealth(url);
      console.log(`${node.name} is healthy`);
      return { node, url };
    }),
  );

  // Install + auth must be sequential: both nodes read the same .mpk path
  // and racing them causes intermittent "No such file or directory" errors.
  const nodeStates = [];
  for (const { node, url } of readyNodes) {
    const tokens = await authenticate(url);
    const appId = await installBundle(url, tokens.accessToken);
    console.log(`${node.name}: authenticated, bundle installed (${appId})`);
    nodeStates.push({ name: node.name, adminUrl: url, appId, ...tokens });
  }

  // Save state for tests and teardown. Only spawned PIDs are killed at teardown
  // — reused nodes (pids empty) are left running for the next run.
  writeFileSync(STATE_FILE, JSON.stringify({
    pids,
    nodes: nodeStates,
  }));

  process.env['NODE_URL'] = nodeStates[0].adminUrl;
}
