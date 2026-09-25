/**
 * Playwright global setup: one native merod with embedded auth, the Mero Chess
 * bundle installed, and a namespace + table created — the state a player
 * reaches after logging in and opening a table.
 *
 * Native merod, not merobox: the specs drive a browser against the node's own
 * admin API on loopback, so there is no reason to pay for Docker here. The
 * two-node story — a move replicating, a result both nodes derive — stays in
 * logic/workflows/play-a-game.yml, which is what actually needs two nodes.
 *
 * ONE node is enough to play a whole game here because the contract allows one
 * account to hold both chairs (see `sit`): the browser plays pass-and-play,
 * which exercises every rule, every refusal and the whole board UI without a
 * second node's discovery and key-delivery race in the middle of a UI test.
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
const REPO_ROOT = path.resolve(APP_DIR, "..", "..", "..");
const LOGIC_DIR = path.resolve(APP_DIR, "..", "logic");

export const DATA_DIR = path.resolve(APP_DIR, ".playwright-data");
export const STATE_FILE = path.resolve(DATA_DIR, "state.json");

const NODE_NAME = "chess-pw";
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
  // CI's browser job downloads the bundle and exports its path as
  // `KV_MPK_PATH` — a generic-but-kv-named variable every app's setup reads.
  // `APP_MPK_PATH` is accepted too, so renaming it in ci.yml later needs no
  // change here.
  const fromEnv = process.env["APP_MPK_PATH"] ?? process.env["KV_MPK_PATH"];
  if (fromEnv) return fromEnv;
  // Two directories, because `cargo mero bundle` resolves a relative --output
  // against the WORKSPACE root rather than the manifest it was given. So a
  // bare `cargo mero bundle` in `logic/` writes `<repo>/dist/`, and looking
  // only under `logic/dist/` makes the error below tell you to run the command
  // you just ran.
  const dist = path.resolve(LOGIC_DIR, "dist");
  const exact = path.resolve(dist, "com.calimero.mero-chess.mpk");
  if (existsSync(exact)) return exact;
  const newest = [dist, path.resolve(REPO_ROOT, "dist")]
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.startsWith("com.calimero.mero-chess") && f.endsWith(".mpk"))
        .map((f) => path.resolve(dir, f)),
    )
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
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
      client_name: "mero-chess-e2e",
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
      `mero-chess bundle not found at ${MPK}.\n` +
        `Build it first:  cd apps/mero-chess/logic && cargo mero bundle\n` +
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

    // ⚠️ Drop the IPv6 listen addresses `merod init` writes.
    //
    // A host with IPv6 disabled — most containers, and the dev sandbox this was
    // written in — fails the whole startup with
    //
    //     failed to listen on '/ip6/::/tcp/2510'
    //     Address family not supported by protocol (os error 97)
    //
    // and the suite then dies at "never became healthy", which reads like a
    // slow node rather than a missing address family. Nothing here needs IPv6:
    // the specs and the admin calls are all against 127.0.0.1, and this node
    // never dials a peer.
    const configPath = path.join(DATA_DIR, NODE_NAME, "config.toml");
    if (existsSync(configPath)) {
      const withoutV6 = readFileSync(configPath, "utf-8")
        .split("\n")
        .filter((line) => !line.includes("/ip6/"))
        .join("\n");
      writeFileSync(configPath, withoutV6);
    }

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
    // ⚠️ `path` ONLY — see the note in the other apps' global-setup: core
    // dropped `metadata` and the route denies unknown fields.
    { path: MPK },
  );

  const { namespaceId } = await api<{ namespaceId: string }>(
    `${NODE_URL}/admin-api/namespaces`,
    tokens.accessToken,
    "POST",
    { applicationId, name: "chess-e2e" },
  );

  const context = await api<{ contextId: string }>(
    `${NODE_URL}/admin-api/contexts`,
    tokens.accessToken,
    "POST",
    // `initializationParams` is REQUIRED and is a Vec<u8>, not an object —
    // omitting it is a 400 naming the field, and passing `{}` deserialises as
    // the wrong type. It is the JSON of the contract's `init` arguments, as
    // BYTES: `init(title, now)` here, so an empty array would fail at context
    // creation with an opaque 500 (core reports a contract-side init failure
    // without a body).
    {
      applicationId,
      groupId: namespaceId,
      initializationParams: Array.from(
        new TextEncoder().encode(JSON.stringify({ title: "E2E table", now: Date.now() })),
      ),
    },
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
