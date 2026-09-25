/**
 * Playwright global setup for the NODE-backed suite: one native merod with
 * embedded auth and the Mero Updates bundle installed — the state a founder is
 * in right after connecting their node. Everything after that (creating the
 * company, the audience, publishing) the specs do through the UI, because that
 * is the path that has to work.
 *
 * Native merod rather than merobox, same as kv-store: one node on loopback
 * needs no Docker. Two-node convergence is logic/workflows/e2e.yml's job.
 */
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const LOGIC_DIR = path.resolve(APP_DIR, "..", "logic");

export const DATA_DIR = path.resolve(APP_DIR, ".playwright-data");
export const STATE_FILE = path.resolve(DATA_DIR, "state.json");

const NODE_NAME = "updates-pw";
// Off kv-store's 2610/2510 so the two suites can run side by side.
const SERVER_PORT = Number(process.env["PW_SERVER_PORT"]) || 2695;
const SWARM_PORT = Number(process.env["PW_SWARM_PORT"]) || 2595;
const NODE_URL = `http://localhost:${SERVER_PORT}`;

// Throwaway credentials for a loopback node deleted at teardown.
const ADMIN_USER = "admin";
const ADMIN_PASSWORD = "adminadmin";
const AUTH_ENV = { MERO_AUTH_ADMIN_USER: ADMIN_USER, MERO_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD };

function resolveMerod(): string {
  const fromEnv = process.env["MEROD_BINARY"];
  if (fromEnv) return fromEnv;
  const home = process.env["HOME"] || "";
  for (const c of ["/usr/local/bin/merod", "/usr/bin/merod", home && path.join(home, ".local", "merod", "merod")]) {
    if (c && existsSync(c)) return c;
  }
  return "merod";
}

/** CI hands the bundle the wasm job built in as KV_MPK_PATH (the name is historical). */
function resolveMpk(): string {
  return (
    process.env["KV_MPK_PATH"] ||
    process.env["UPDATES_MPK_PATH"] ||
    path.resolve(LOGIC_DIR, "dist", "com.calimero.mero-updates.mpk")
  );
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

/** A client key for `/auth/token`: raw 32-byte ed25519 public key, base64. */
function clientPublicKey(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

async function authenticate(url: string) {
  const resp = await fetch(`${url}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_method: "user_password",
      public_key: clientPublicKey(),
      client_name: "mero-updates-e2e",
      timestamp: Date.now(),
      permissions: ["admin"],
      provider_data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    }),
  });
  if (!resp.ok) throw new Error(`auth failed (${resp.status}): ${await resp.text()}`);
  const body = (await resp.json()) as { data?: { access_token?: string; refresh_token?: string } } & { access_token?: string; refresh_token?: string };
  const t = body.data ?? body;
  if (!t?.access_token) throw new Error(`auth returned no access_token: ${JSON.stringify(body).slice(0, 300)}`);
  return { accessToken: t.access_token as string, refreshToken: t.refresh_token as string };
}

export default async function globalSetup() {
  const mpk = resolveMpk();
  if (!existsSync(mpk)) {
    throw new Error(
      `Mero Updates bundle not found at ${mpk}.\n` +
        `Build it:  cargo mero bundle --manifest-path apps/mero-updates/logic/Cargo.toml --dev --app-version 0.0.0 ` +
        `--output apps/mero-updates/logic/dist/com.calimero.mero-updates.mpk`,
    );
  }

  const pids: number[] = [];
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const merod = resolveMerod();
  execFileSync(
    merod,
    [
      "--home", DATA_DIR,
      "--node", NODE_NAME,
      "init",
      "--server-port", String(SERVER_PORT),
      "--swarm-port", String(SWARM_PORT),
      "--auth-mode", "embedded",
      "--auth-storage", "memory",
    ],
    // `--auth-storage memory` mints the admin from the ENVIRONMENT at every
    // start, so the credentials must be present for init and run alike.
    { stdio: "pipe", env: { ...process.env, ...AUTH_ENV } },
  );
  // IPv4 only. `init` also writes `/ip6/::` listen addresses, and a host
  // without IPv6 (some containers and sandboxes) kills `run` with
  // `failed to listen on '/ip6/::/tcp/…': Address family not supported`. This
  // node only ever talks to a browser on 127.0.0.1, so nothing is lost.
  const configPath = path.join(DATA_DIR, NODE_NAME, "config.toml");
  writeFileSync(
    configPath,
    readFileSync(configPath, "utf-8")
      .split("\n")
      .filter((line) => !/^\s*"\/ip6\//.test(line))
      .join("\n"),
  );

  const proc = spawn(merod, ["--home", DATA_DIR, "--node", NODE_NAME, "run"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...AUTH_ENV },
  });
  const log = createWriteStream(path.join(DATA_DIR, `${NODE_NAME}.log`));
  proc.stdout?.pipe(log);
  proc.stderr?.pipe(log);
  if (proc.pid) pids.push(proc.pid);

  await waitForHealth(NODE_URL);
  const tokens = await authenticate(NODE_URL);

  const resp = await fetch(`${NODE_URL}/admin-api/install-dev-application`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.accessToken}` },
    body: JSON.stringify({ path: mpk }),
  });
  if (!resp.ok) throw new Error(`install failed (${resp.status}): ${await resp.text()}`);

  writeFileSync(STATE_FILE, JSON.stringify({ pids, nodeUrl: NODE_URL, ...tokens }, null, 2));
}

export function readState() {
  return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as {
    pids: number[];
    nodeUrl: string;
    accessToken: string;
    refreshToken: string;
  };
}
