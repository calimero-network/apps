import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { stopNodes } from "./teardown";
import { readTomlString, setTomlKey } from "./toml";

export const ADMIN_USER = "admin";
export const ADMIN_PASSWORD = "adminadmin";

export interface RigNode {
  name: string;
  home: string;
  url: string;
  serverPort: number;
  swarmPort: number;
  peerId: string;
  pid: number;
  adminToken: string;
  applicationId: string;
  log: string;
}

export interface RigState {
  dataDir: string;
  merod: string;
  merodVersion: string;
  mpk: string;
  nodes: RigNode[];
}

export interface RigOptions {
  dataDir: string;
  mpk: string;
  nodes?: number;
  basePort?: number;
  merod?: string;
}

export function resolveMerod(): string {
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
    return path.join(process.env["HOME"] ?? "", ".local", "merod", "merod");
  }
  return "merod";
}

export function resolveMpk(appDir: string, packageId: string): string {
  const fromEnv = process.env["JOURNEY_MPK"] ?? process.env["KV_MPK_PATH"];
  if (fromEnv) return fromEnv;
  const candidates = [
    path.resolve(appDir, "..", "logic", "dist"),
    path.resolve(appDir, "..", "..", "..", "dist"),
  ];
  for (const dir of candidates) {
    const exact = path.join(dir, `${packageId}.mpk`);
    if (existsSync(exact)) return exact;
  }
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const newest = readdirSync(dir)
      .filter((f) => f.endsWith(".mpk") && f.startsWith(packageId))
      .map((f) => path.join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (newest) return newest;
  }
  throw new Error(
    `no bundle for ${packageId}: set JOURNEY_MPK, or build one with \`cargo mero bundle\` in ${path.resolve(appDir, "..", "logic")}`,
  );
}

function nodeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["MERO_AUTH_ADMIN_USER"];
  delete env["MERO_AUTH_ADMIN_PASSWORD"];
  return {
    ...env,
    RUST_LOG: process.env["JOURNEY_RUST_LOG"] ?? "merod=info,calimero_=info,calimero_node::manager::startup=debug",
  };
}

function configPath(node: Pick<RigNode, "home" | "name">): string {
  return path.join(node.home, node.name, "config.toml");
}

export async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/admin-api/health`)).ok;
  } catch {
    return false;
  }
}

export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined | false>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v !== undefined && v !== false) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`${what} did not happen within ${timeoutMs}ms${last ? `: ${String(last)}` : ""}`);
}

export async function mintAdminToken(url: string): Promise<string> {
  const resp = await fetch(`${url}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_method: "user_password",
      public_key: randomBytes(32).toString("base64"),
      client_name: "journey-harness",
      timestamp: Date.now(),
      permissions: ["admin"],
      provider_data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    }),
  });
  if (!resp.ok) throw new Error(`POST ${url}/auth/token -> ${resp.status}: ${await resp.text()}`);
  const body = (await resp.json()) as { data?: { access_token?: string }; access_token?: string };
  const token = body.data?.access_token ?? body.access_token;
  if (!token) throw new Error(`POST ${url}/auth/token returned no access_token`);
  return token;
}

export async function adminApi<T = unknown>(
  node: Pick<RigNode, "url" | "adminToken">,
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const resp = await fetch(`${node.url}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${node.adminToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${method} ${node.url}${route} -> ${resp.status}: ${text.slice(0, 500)}`);
  const parsed = text ? (JSON.parse(text) as { data?: T }) : {};
  return ((parsed as { data?: T }).data ?? parsed) as T;
}

function initNode(merod: string, node: Omit<RigNode, "pid" | "adminToken" | "applicationId" | "peerId">): string {
  mkdirSync(node.home, { recursive: true });
  const passwordFile = path.join(node.home, "admin-password");
  writeFileSync(passwordFile, ADMIN_PASSWORD);
  execFileSync(
    merod,
    [
      "--home", node.home,
      "--node", node.name,
      "init",
      "--server-port", String(node.serverPort),
      "--swarm-port", String(node.swarmPort),
      "--auth-mode", "embedded",
      "--auth-storage", "persistent",
      "--admin-user", ADMIN_USER,
      "--admin-password-file", passwordFile,
    ],
    { stdio: "pipe", env: nodeEnv() },
  );
  const file = configPath(node);
  const peerId = readTomlString(readFileSync(file, "utf8"), "identity", "peer_id");
  if (!peerId) throw new Error(`no [identity] peer_id in ${file}`);
  return peerId;
}

function isolate(file: string, rendezvous: string, bootstrap: string[]): void {
  let toml = readFileSync(file, "utf8");
  toml = setTomlKey(toml, "bootstrap", "nodes", bootstrap);
  toml = setTomlKey(toml, "discovery", "mdns", true);
  toml = setTomlKey(toml, "discovery.rendezvous", "namespace", rendezvous);
  toml = setTomlKey(toml, "sync", "interval_ms", 500);
  toml = setTomlKey(toml, "sync", "frequency_ms", 1000);
  writeFileSync(file, toml);
}

export function spawnNode(merod: string, node: Pick<RigNode, "home" | "name" | "log">): number {
  const out = openSync(node.log, "a");
  const proc = spawn(merod, ["--home", node.home, "--node", node.name, "run"], {
    stdio: ["ignore", out, out],
    env: nodeEnv(),
    detached: true,
  });
  proc.unref();
  if (!proc.pid) throw new Error(`could not start ${node.name}`);
  return proc.pid;
}

export async function peerCount(node: Pick<RigNode, "url" | "adminToken">): Promise<number> {
  const body = await adminApi<{ count?: number }>(node, "GET", "/admin-api/peers");
  return Number(body.count ?? 0);
}

export async function startRig(opts: RigOptions): Promise<RigState> {
  const merod = opts.merod ?? resolveMerod();
  const count = opts.nodes ?? 2;
  const basePort = opts.basePort ?? (Number(process.env["JOURNEY_BASE_PORT"]) || 2740);
  if (!existsSync(opts.mpk)) throw new Error(`bundle not found: ${opts.mpk}`);

  rmSync(opts.dataDir, { recursive: true, force: true });
  mkdirSync(opts.dataDir, { recursive: true });
  const merodVersion = execFileSync(merod, ["--version"]).toString().trim();
  const rendezvous = `/calimero/journey/${randomBytes(4).toString("hex")}`;

  const planned = Array.from({ length: count }, (_, i) => {
    const name = `journey-${i + 1}`;
    return {
      name,
      home: path.join(opts.dataDir, name),
      serverPort: basePort + i * 2,
      swarmPort: basePort + i * 2 + 1,
      url: `http://localhost:${basePort + i * 2}`,
      log: path.join(opts.dataDir, `${name}.log`),
    };
  });

  const peerIds = planned.map((n) => initNode(merod, n));
  planned.forEach((n, i) => {
    const bootstrap =
      i === 0 ? [] : [`/ip4/127.0.0.1/tcp/${planned[0]!.swarmPort}/p2p/${peerIds[0]}`];
    isolate(configPath(n), rendezvous, bootstrap);
  });

  const nodes: RigNode[] = [];
  const state: RigState = { dataDir: opts.dataDir, merod, merodVersion, mpk: opts.mpk, nodes };
  try {
    for (const [i, n] of planned.entries()) {
      const pid = spawnNode(merod, n);
      nodes.push({ ...n, peerId: peerIds[i]!, pid, adminToken: "", applicationId: "" });
      writeRigState(state);
    }
    for (const node of nodes) {
      await waitFor(`${node.name} healthy on ${node.url}`, () => healthy(node.url), 60_000);
      node.adminToken = await mintAdminToken(node.url);
    }
    if (nodes.length > 1) {
      for (const node of nodes) {
        await waitFor(
          `${node.name} connected to a peer (bootstrap ${nodes[0]!.swarmPort})`,
          async () => (await peerCount(node)) > 0,
          60_000,
        );
      }
    }
    for (const node of nodes) {
      const installed = await adminApi<{ applicationId: string }>(
        node,
        "POST",
        "/admin-api/install-dev-application",
        { path: opts.mpk },
      );
      node.applicationId = installed.applicationId;
    }
    writeRigState(state);
    return state;
  } catch (e) {
    await stopNodes(nodes.map((n) => n.pid));
    const logs = nodes
      .map((n) => {
        try {
          return `--- ${n.name} (tail)\n${readFileSync(n.log, "utf8").split("\n").slice(-40).join("\n")}`;
        } catch {
          return `--- ${n.name}: no log`;
        }
      })
      .join("\n");
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n${logs}`);
  }
}

export function rigStatePath(dataDir: string): string {
  return path.join(dataDir, "rig.json");
}

export function writeRigState(state: RigState): void {
  writeFileSync(rigStatePath(state.dataDir), JSON.stringify(state, null, 2));
}

export function readRigState(dataDir: string): RigState {
  return JSON.parse(readFileSync(rigStatePath(dataDir), "utf8")) as RigState;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startUntilHealthy(state: RigState, node: RigNode, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    node.pid = spawnNode(state.merod, node);
    writeRigState(state);
    while (Date.now() < deadline && isAlive(node.pid)) {
      if (await healthy(node.url)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`${node.name} did not come back healthy within ${timeoutMs}ms; see ${node.log}`);
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function meshTotals(log: string, from = 0): number[] {
  if (!existsSync(log)) return [];
  const text = readFileSync(log).subarray(from).toString("utf8").replace(ANSI, "");
  return [...text.matchAll(/gossipsub mesh summary.*?total_mesh_peers=(\d+)/g)].map((m) => Number(m[1]));
}

export async function restartNode(state: RigState, index: number): Promise<RigNode> {
  const node = state.nodes[index];
  if (!node) throw new Error(`no node ${index} in the rig`);
  const meshBefore = meshTotals(node.log).at(-1) ?? 0;
  const logOffset = existsSync(node.log) ? statSync(node.log).size : 0;
  await stopNodes([node.pid]);
  await startUntilHealthy(state, node, 90_000);
  node.adminToken = await mintAdminToken(node.url);
  writeRigState(state);
  if (state.nodes.length > 1) {
    await waitFor(`${node.name} reconnected to a peer`, async () => (await peerCount(node)) > 0, 60_000);
    if (meshBefore > 0 && process.env["JOURNEY_WRITE_BEFORE_MESH"] !== "1") {
      await waitFor(
        `${node.name}'s gossip mesh back to ${meshBefore} peer slot(s)`,
        async () => meshTotals(node.log, logOffset).some((n) => n >= meshBefore),
        120_000,
        1_000,
      );
    }
  }
  return node;
}

export async function stopRig(dataDir: string, keep = false): Promise<void> {
  let state: RigState;
  try {
    state = readRigState(dataDir);
  } catch {
    return;
  }
  await stopNodes(state.nodes.map((n) => n.pid));
  if (keep) return;
  for (const node of state.nodes) {
    try {
      rmSync(node.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      console.warn(`could not remove ${node.home}:`, e);
    }
  }
}
