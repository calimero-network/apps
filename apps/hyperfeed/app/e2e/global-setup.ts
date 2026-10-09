/**
 * Playwright global setup for the NODE-backed suite: one native merod with
 * embedded auth and the Hyperfeed bundle installed, the state you are in right
 * after connecting your node. Creating the feed and answering in it the spec
 * does through the UI, because that is the path that has to work.
 *
 * Native merod rather than merobox, same as mero-updates: one node on loopback
 * needs no Docker. Two-node behaviour is logic/workflows/feed.yml's job.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeToLog } from "@calimero-apps/e2e-node";
import { MeroJs } from "@calimero-network/mero-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const LOGIC_DIR = path.resolve(APP_DIR, "..", "logic");

export const DATA_DIR = path.resolve(APP_DIR, ".playwright-data");
export const STATE_FILE = path.resolve(DATA_DIR, "state.json");

const NODE_NAME = "hyperfeed-pw";
// Off kv-store's 2610/2510 and mero-updates' 2695/2595 so suites can run side by side.
const SERVER_PORT = Number(process.env["PW_SERVER_PORT"]) || 2697;
const SWARM_PORT = Number(process.env["PW_SWARM_PORT"]) || 2597;
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
    process.env["HYPERFEED_MPK_PATH"] ||
    path.resolve(LOGIC_DIR, "dist", "com.calimero.hyperfeed.mpk")
  );
}

/** The node through mero-js: health, login and install are the SDK's, not hand-rolled HTTP. */
function client(): MeroJs {
  return new MeroJs({ baseUrl: NODE_URL, credentials: { username: ADMIN_USER, password: ADMIN_PASSWORD } });
}

async function waitForHealth(mero: MeroJs, timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await mero.admin.healthCheck();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`merod at ${NODE_URL} never became healthy within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  const mpk = resolveMpk();
  if (!existsSync(mpk)) {
    throw new Error(
      `Hyperfeed bundle not found at ${mpk}.\n` +
        `Build it:  cargo mero bundle --manifest-path apps/hyperfeed/logic/Cargo.toml --dev --app-version 0.0.0 ` +
        `--output apps/hyperfeed/logic/dist/com.calimero.hyperfeed.mpk`,
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
  // IPv4 only: a host without IPv6 kills `run` on the `/ip6/::` listen
  // addresses `init` writes. This node only talks to a browser on 127.0.0.1.
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
  pipeToLog(proc, path.join(DATA_DIR, `${NODE_NAME}.log`));
  if (proc.pid) pids.push(proc.pid);

  const mero = client();
  await waitForHealth(mero);
  const tokens = await mero.authenticate();
  // A login callback names the application it is for; the spec's login does too.
  const { applicationId } = await mero.admin.installDevApplication({ path: mpk });

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { pids, nodeUrl: NODE_URL, applicationId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
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
    accessToken: string;
    refreshToken: string;
  };
}
