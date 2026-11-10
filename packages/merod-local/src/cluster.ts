/**
 * `merod local` (core's in-process development cluster: three nodes on
 * 127.0.0.1:2501-2503, mock attestation, a development storage key), and what
 * every command here needs around it: the repo's paths, the pinned core tag,
 * signing up an account with a software passkey, building a component.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CalimeroClient } from "@calimero-network/mero-js";

import { SoftPasskey } from "./soft-passkey.ts";

/** The repository root. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where `merod local` keeps its state and log (gitignored). */
export const STATE_DIR = join(ROOT, ".merod-local");

/** The nodes `merod local` starts: node i listens on 2500 + i. */
export const LOCAL_NODES = ["http://127.0.0.1:2501", "http://127.0.0.1:2502", "http://127.0.0.1:2503"];

/**
 * The origin and relying party a software passkey answers for. `merod local`
 * trusts passkey ceremonies from `http://localhost:3000` and
 * `http://localhost:5173` (Vite's dev server) unless `--origins` says otherwise.
 */
export const PASSKEY_ORIGIN = "http://localhost:5173";
export const PASSKEY_RP_ID = "localhost";

/** `component-core-tag` from the root Cargo.toml: the core release everything here pins. */
export function coreTag(): string {
  const text = readFileSync(join(ROOT, "Cargo.toml"), "utf8");
  const match = /^component-core-tag\s*=\s*"([^"]+)"/m.exec(text);
  if (!match?.[1]) throw new Error("the root Cargo.toml has no component-core-tag");
  return match[1];
}

/** The merod binary: `MEROD_BIN`, else `merod` on the PATH. */
export function merodBinary(): string {
  return process.env.MEROD_BIN ?? "merod";
}

function installHint(): string {
  const tag = coreTag();
  return [
    `merod ${tag} is needed (MEROD_BIN, or merod on the PATH). Either:`,
    `  curl -fsSL https://github.com/calimero-network/core/releases/download/${tag}/merod_x86_64-unknown-linux-gnu.tar.gz | tar xz`,
    `  cargo install --locked --git https://github.com/calimero-network/core --tag ${tag} merod`,
  ].join("\n");
}

/** Throws with the install hint unless the merod binary runs. */
export function assertMerod(): void {
  const probe = spawnSync(merodBinary(), ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) throw new Error(installHint());
}

/** Whether node `url` answers `/health` with a system leader. */
export async function healthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`);
    if (!response.ok) return false;
    const health = (await response.json()) as { systemLeader?: unknown };
    return Boolean(health.systemLeader);
  } catch {
    return false;
  }
}

/** Waits until every node in `nodes` is healthy. */
export async function waitHealthy(nodes: string[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (const node of nodes) {
    while (!(await healthy(node))) {
      if (Date.now() > deadline) throw new Error(`${node} did not become healthy within ${timeoutMs / 1000}s`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  // As mero-js's cluster tests do: let the leader register the nodes and mint
  // its first session key before the first sign-up.
  await new Promise((r) => setTimeout(r, 1500));
}

export interface Started {
  child: ChildProcess;
  stop(): void;
}

/**
 * Starts `merod local` (state in {@link STATE_DIR}, `--fresh` to start over) and
 * waits for its nodes. `log` names a file for its output; without one it shares
 * this terminal. `origins` replaces the origins passkey ceremonies are trusted
 * from (merod's default: `http://localhost:3000` and {@link PASSKEY_ORIGIN}),
 * for a run that serves more than two frontends at once.
 */
export async function startCluster(
  options: { fresh?: boolean; log?: string; origins?: string[] } = {},
): Promise<Started> {
  assertMerod();
  mkdirSync(STATE_DIR, { recursive: true });
  const args = [
    "local",
    "--dir",
    join(STATE_DIR, "cluster"),
    ...(options.fresh ? ["--fresh"] : []),
    ...(options.origins?.length ? ["--origins", options.origins.join(",")] : []),
  ];
  const child = spawn(merodBinary(), args, {
    stdio: options.log ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { RUST_LOG: "warn,openraft=off", ...process.env },
  });
  if (options.log) {
    const out = createWriteStream(options.log, { flags: "a" });
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
  }
  let exited: string | undefined;
  child.on("exit", (code, signal) => {
    exited = `merod local exited (${signal ?? code})`;
  });
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
  };
  try {
    const deadline = Date.now() + 90_000;
    while (!(await healthy(LOCAL_NODES[0] as string))) {
      if (exited) throw new Error(`${exited}${options.log ? `; see ${options.log}` : ""}`);
      if (Date.now() > deadline) throw new Error("merod local did not become healthy within 90s");
      await new Promise((r) => setTimeout(r, 250));
    }
    await waitHealthy(LOCAL_NODES);
  } catch (error) {
    stop();
    throw error;
  }
  return { child, stop };
}

/** A client for `node`, trusting the cluster's mock quotes (development only). */
export function localClient(node: string, nodes: string[] = LOCAL_NODES): CalimeroClient {
  return new CalimeroClient({
    baseUrl: node,
    nodes: nodes.filter((n) => n !== node),
    policy: { allowMock: true },
  });
}

export interface Person {
  name: string;
  client: CalimeroClient;
  passkey: SoftPasskey;
  accountId: string;
}

/** Signs up `name` on `node` with a fresh software passkey. */
export async function signUp(name: string, node: string, nodes: string[] = LOCAL_NODES): Promise<Person> {
  const client = localClient(node, nodes);
  const passkey = new SoftPasskey(PASSKEY_RP_ID, PASSKEY_ORIGIN);
  const session = await client.signUp(passkey, name);
  return { name, client, passkey, accountId: session.accountId };
}

/** `apps/<app>`, checked to be a component app. */
export function appDir(app: string): string {
  const dir = join(ROOT, "apps", app);
  const manifest = join(dir, "logic", "Cargo.toml");
  if (!existsSync(manifest)) throw new Error(`apps/${app}/logic/Cargo.toml does not exist`);
  if (!/^calimero-sdk\s*=.*[{,]\s*git\s*=/m.test(readFileSync(manifest, "utf8"))) {
    throw new Error(`apps/${app} is not a component app (its logic does not depend on calimero-sdk from core's git)`);
  }
  return dir;
}

/**
 * Builds `apps/<app>/logic` with `tools/component-bundle` (core's builder at
 * the pinned tag) and returns the component's path.
 */
export function buildComponent(app: string): string {
  const logic = join(appDir(app), "logic");
  const built = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--release",
      "--manifest-path",
      join(ROOT, "tools/component-bundle/Cargo.toml"),
      "--",
      "build",
      logic,
    ],
    { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
  );
  if (built.status !== 0) throw new Error(`building apps/${app}/logic failed`);
  const path = built.stdout.trim().split("\n").pop();
  if (!path || !existsSync(path)) throw new Error(`the build printed no component path (${built.stdout})`);
  return path;
}

/** The scenario files of `apps/<app>`: `scenarios/*.json`, then `scenarios/cluster/*.json`. */
export function scenarioFiles(app: string): string[] {
  const base = join(appDir(app), "logic", "scenarios");
  const list = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json") && !f.endsWith(".org.json"))
          .sort()
          .map((f) => join(dir, f))
      : [];
  return [...list(base), ...list(join(base, "cluster"))];
}
