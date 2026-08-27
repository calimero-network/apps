/**
 * Playwright global setup: one native merod with embedded auth, the kv-store
 * bundle installed, and a namespace + context created — the state a user
 * reaches after logging in and picking a context.
 *
 * Native merod, not merobox: the specs drive a browser against the node's own
 * admin API on loopback, so there is no reason to pay for Docker here. The
 * contract-level convergence story stays in logic/workflows/simple-store.yml,
 * which is what actually needs two nodes.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const LOGIC_DIR = path.resolve(APP_DIR, "..", "logic");

export const DATA_DIR = path.resolve(APP_DIR, ".playwright-data");
export const STATE_FILE = path.resolve(DATA_DIR, "state.json");

const NODE_NAME = "kv-pw";
const SERVER_PORT = Number(process.env["PW_SERVER_PORT"]) || 2610;
const SWARM_PORT = Number(process.env["PW_SWARM_PORT"]) || 2510;
const NODE_URL = `http://localhost:${SERVER_PORT}`;

// merod provisions the admin account at `init` and refuses to start embedded
// auth without one, so the credentials go there rather than into a first login.
// Throwaway, for a loopback node that is deleted at teardown. The password is
// subject to an 8-character minimum.
const ADMIN_USER = "admin";
const ADMIN_PASSWORD = "adminadmin";

/** $MEROD_BINARY -> PATH -> the usual install locations. */
function resolveMerod(): string {
  const fromEnv = process.env["MEROD_BINARY"];
  if (fromEnv) return fromEnv;
  try {
    const onPath = execFileSync("command", ["-v", "merod"], {
      shell: "/bin/sh",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (onPath) return onPath;
  } catch {
    /* not on PATH */
  }
  const home = process.env["HOME"] || "";
  for (const c of [
    "/usr/local/bin/merod",
    "/usr/bin/merod",
    home && path.join(home, ".local", "merod", "merod"),
    home && path.join(home, "bin", "merod"),
  ]) {
    if (c && existsSync(c)) return c;
  }
  return "merod";
}

/**
 * The bundle `cargo mero bundle` produced. Named after the package id, so the
 * exact path is stable; the newest-.mpk fallback covers a bundle built under an
 * older layout, and reports which file it settled on rather than guessing
 * silently.
 */
function resolveMpk(): string {
  const fromEnv = process.env["KV_MPK_PATH"];
  if (fromEnv) return fromEnv;
  const dist = path.resolve(LOGIC_DIR, "dist");
  const exact = path.resolve(dist, "com.calimero.kv-store.mpk");
  if (existsSync(exact)) return exact;
  const newest = existsSync(dist)
    ? readdirSync(dist)
        .filter((f) => f.endsWith(".mpk"))
        .map((f) => path.resolve(dist, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  if (newest) {
    console.log(`[setup] using newest bundle ${path.basename(newest)}`);
    return newest;
  }
  return exact; // keep the exact path so the error below names the file we wanted
}

const MEROD = resolveMerod();
const MPK = resolveMpk();

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

async function authenticate(url: string) {
  const keypair = nacl.sign.keyPair();
  const resp = await fetch(`${url}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_method: "user_password",
      public_key: Buffer.from(keypair.publicKey).toString("base64"),
      client_name: "kv-store-e2e",
      timestamp: Date.now(),
      permissions: ["admin"],
      provider_data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    }),
  });
  if (!resp.ok) throw new Error(`auth failed (${resp.status}): ${await resp.text()}`);
  const body = await resp.json();
  const t = body.data ?? body;
  if (!t?.access_token) throw new Error(`auth returned no access_token: ${JSON.stringify(body).slice(0, 300)}`);
  return { accessToken: t.access_token as string, refreshToken: t.refresh_token as string };
}

async function api<T>(url: string, token: string, method: string, body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`${method} ${url} -> ${resp.status}: ${await resp.text()}`);
  const parsed = await resp.json();
  return (parsed.data ?? parsed) as T;
}

export default async function globalSetup() {
  if (!existsSync(MPK)) {
    throw new Error(
      `kv-store bundle not found at ${MPK}.\n` +
        `Build it first:  cd apps/kv-store/logic && cargo mero bundle\n` +
        `Or point KV_MPK_PATH at an existing .mpk.`,
    );
  }

  // Reuse a node that is already up (fast local iteration); otherwise start
  // clean. Only PIDs we spawned are killed at teardown, so a reused node
  // survives the run.
  const reuse = await healthy(NODE_URL);
  const pids: number[] = [];

  if (reuse) {
    console.log(`[setup] reusing the healthy node already on ${NODE_URL}`);
    mkdirSync(DATA_DIR, { recursive: true });
  } else {
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    execFileSync(
      MEROD,
      [
        "--home", DATA_DIR,
        "--node", NODE_NAME,
        "init",
        "--server-port", String(SERVER_PORT),
        "--swarm-port", String(SWARM_PORT),
        "--auth-mode", "embedded",
        "--auth-storage", "memory",
      ],
      {
        stdio: "pipe",
        // ⚠️ `--auth-storage memory` mints the admin from these at every
        // startup and IGNORES init-time credential flags, so they have to be
        // in the environment for both commands or login fails with a correct
        // password.
        env: { ...process.env, MERO_AUTH_ADMIN_USER: ADMIN_USER, MERO_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD },
      },
    );

    const proc = spawn(MEROD, ["--home", DATA_DIR, "--node", NODE_NAME, "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MERO_AUTH_ADMIN_USER: ADMIN_USER, MERO_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD },
    });
    const log = createWriteStream(path.join(DATA_DIR, `${NODE_NAME}.log`));
    proc.stdout?.pipe(log);
    proc.stderr?.pipe(log);
    if (proc.pid) pids.push(proc.pid);
    console.log(`[setup] ${NODE_NAME} started (pid ${proc.pid})`);
  }

  await waitForHealth(NODE_URL);

  const tokens = await authenticate(NODE_URL);

  const { applicationId } = await api<{ applicationId: string }>(
    `${NODE_URL}/admin-api/install-dev-application`,
    tokens.accessToken,
    "POST",
    { path: MPK, metadata: [] },
  );

  const { namespaceId } = await api<{ namespaceId: string }>(
    `${NODE_URL}/admin-api/namespaces`,
    tokens.accessToken,
    "POST",
    { applicationId, name: "kv-e2e" },
  );

  const context = await api<{ contextId: string }>(
    `${NODE_URL}/admin-api/contexts`,
    tokens.accessToken,
    "POST",
    // `initializationParams` is REQUIRED and is a Vec<u8>, not an object —
    // omitting it is a 400 naming the field, and passing `{}` deserialises as
    // the wrong type. kv-store's `init` takes nothing, so it is empty.
    { applicationId, groupId: namespaceId, initializationParams: [] },
  );

  console.log(
    `[setup] app=${applicationId.slice(0, 8)}… namespace=${namespaceId.slice(0, 8)}… context=${context.contextId.slice(0, 8)}…`,
  );

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { pids, nodeUrl: NODE_URL, applicationId, namespaceId, contextId: context.contextId, ...tokens },
      null,
      2,
    ),
  );
}

export function readState() {
  return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as {
    pids: number[];
    nodeUrl: string;
    applicationId: string;
    namespaceId: string;
    contextId: string;
    accessToken: string;
    refreshToken: string;
  };
}
