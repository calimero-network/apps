/**
 * Real-node global setup for `pnpm test:e2e:ci`: one native merod with embedded
 * auth, the chat bundle installed, and a workspace with a `general` channel —
 * the state a user reaches after creating a workspace in the app.
 *
 * WHY THIS EXISTS. Until now every mero-chat browser test in CI answered the
 * node from `page.route` mocks. The specs that drive the real UI against a real
 * node (chat.spec.ts, the rpc/sse specs) all skipped, because nothing gave them
 * a node: scripts/setup-nodes.sh needs Docker-era tooling and is itself broken
 * against current core (its context create sends `protocol`/`alias`, its
 * JSON-RPC sends `executorPublicKey` — all refused). So "create workspace",
 * "create channel" and "send message" had never run against merod in CI, and
 * two of them shipped as 400s. The CI job already installs merod and downloads
 * this app's bundle; this puts them to use.
 *
 * Native merod, not merobox — the same approach as apps/kv-store/app/e2e.
 *
 * Every body below is the one the app itself sends (see nodeApiDataSource.ts
 * and groupApiDataSource.ts), so a seed that works is evidence about the app's
 * wire shapes, not a second opinion about them.
 */
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..", "..");
const LOGIC_DIR = path.resolve(APP_DIR, "..", "logic");

export const DATA_DIR = path.resolve(APP_DIR, ".playwright-data");
export const STATE_FILE = path.resolve(DATA_DIR, "state.json");

const NODE_NAME = "chat-pw";
const SERVER_PORT = Number(process.env.PW_SERVER_PORT) || 2620;
const SWARM_PORT = Number(process.env.PW_SWARM_PORT) || 2520;
const NODE_URL = `http://localhost:${SERVER_PORT}`;

// Throwaway credentials for a loopback node deleted at teardown (8-char min).
const ADMIN_USER = "admin";
const ADMIN_PASSWORD = "adminadmin";
const ADMIN_ENV = { MERO_AUTH_ADMIN_USER: ADMIN_USER, MERO_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD };

function resolveMerod(): string {
  if (process.env.MEROD_BINARY) return process.env.MEROD_BINARY;
  try {
    const onPath = execFileSync("command", ["-v", "merod"], { shell: "/bin/sh", stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (onPath) return onPath;
  } catch {
    /* not on PATH */
  }
  const home = process.env.HOME ?? "";
  for (const c of ["/usr/local/bin/merod", home && path.join(home, ".local", "merod", "merod")]) {
    if (c && existsSync(c)) return c;
  }
  return "merod";
}

/** CI hands the downloaded bundle in as KV_MPK_PATH (the name is shared by every app's browser job). */
function resolveMpk(): string {
  if (process.env.KV_MPK_PATH) return process.env.KV_MPK_PATH;
  const dist = path.resolve(LOGIC_DIR, "dist");
  const exact = path.resolve(dist, "com.calimero.chat.mpk");
  if (existsSync(exact)) return exact;
  const newest = existsSync(dist)
    ? readdirSync(dist)
        .filter((f) => f.endsWith(".mpk"))
        .map((f) => path.resolve(dist, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  return newest ?? exact;
}

async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/admin-api/health`)).ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`merod at ${url} never became healthy within ${timeoutMs}ms`);
}

async function authenticate(url: string) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const resp = await fetch(`${url}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_method: "user_password",
      public_key: Buffer.from(raw).toString("base64"),
      client_name: "mero-chat-e2e",
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

async function api<T>(token: string, method: string, route: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${NODE_URL}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${method} ${route} -> ${resp.status}: ${text}`);
  if (!text) return undefined as T;
  const parsed = JSON.parse(text);
  return (parsed?.data ?? parsed) as T;
}

/** The chat contract's `init` args, as bytes — exactly what createGroupContext encodes. */
function initParams(name: string, creator: string): number[] {
  const json = JSON.stringify({
    name,
    context_type: "Channel",
    description: "",
    created_at: Math.floor(Date.now() / 1000),
    creator_username: creator,
  });
  return Array.from(new TextEncoder().encode(json));
}

export default async function globalSetup() {
  const MEROD = resolveMerod();
  const MPK = resolveMpk();
  if (!existsSync(MPK)) {
    throw new Error(
      `chat bundle not found at ${MPK}. Build it (cd apps/mero-chat/logic && cargo mero bundle) ` +
        `or point KV_MPK_PATH at an .mpk.`,
    );
  }

  const pids: number[] = [];
  if (await healthy(NODE_URL)) {
    console.log(`[real-node] reusing the healthy node on ${NODE_URL}`);
    mkdirSync(DATA_DIR, { recursive: true });
  } else {
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    execFileSync(
      MEROD,
      [
        "--home", DATA_DIR, "--node", NODE_NAME, "init",
        "--server-port", String(SERVER_PORT), "--swarm-port", String(SWARM_PORT),
        "--auth-mode", "embedded", "--auth-storage", "memory",
      ],
      // `--auth-storage memory` mints the admin from the environment at every
      // start, so the credentials go to both commands.
      { stdio: "pipe", env: { ...process.env, ...ADMIN_ENV } },
    );
    const proc = spawn(MEROD, ["--home", DATA_DIR, "--node", NODE_NAME, "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...ADMIN_ENV },
    });
    const log = createWriteStream(path.join(DATA_DIR, `${NODE_NAME}.log`));
    proc.stdout?.pipe(log);
    proc.stderr?.pipe(log);
    if (proc.pid) pids.push(proc.pid);
    console.log(`[real-node] ${NODE_NAME} started (pid ${proc.pid}) with ${path.basename(MPK)}`);
  }

  await waitForHealth(NODE_URL);
  const tokens = await authenticate(NODE_URL);
  const t = tokens.accessToken;

  const { applicationId } = await api<{ applicationId: string }>(t, "POST", "/admin-api/install-dev-application", {
    path: MPK,
  });

  // The workspace, as CreateWorkspacePopup makes it.
  const { namespaceId } = await api<{ namespaceId: string }>(t, "POST", "/admin-api/namespaces", {
    applicationId,
    name: "E2E Workspace",
  });
  await api(t, "PUT", `/admin-api/groups/${namespaceId}/metadata`, { name: "E2E Workspace" }).catch(
    (e) => console.warn(`[real-node] workspace metadata not set (non-fatal): ${e}`),
  );

  // #general, as ChannelHeader makes a public channel: subgroup → open → context.
  const { groupId: generalGroupId } = await api<{ groupId: string }>(
    t,
    "POST",
    `/admin-api/namespaces/${namespaceId}/groups`,
    { groupName: "general" },
  );
  await api(t, "PUT", `/admin-api/groups/${generalGroupId}/settings/subgroup-visibility`, {
    subgroupVisibility: "open",
  });
  const ctx = await api<{ contextId: string; memberPublicKey: string }>(t, "POST", "/admin-api/contexts", {
    applicationId,
    groupId: generalGroupId,
    name: "general",
    initializationParams: initParams("general", "Alice"),
  });

  console.log(
    `[real-node] app=${applicationId.slice(0, 8)}… workspace=${namespaceId.slice(0, 8)}… ` +
      `#general=${ctx.contextId.slice(0, 8)}…`,
  );

  const env = {
    E2E_NODE_URL: NODE_URL,
    E2E_ACCESS_TOKEN: tokens.accessToken,
    E2E_REFRESH_TOKEN: tokens.refreshToken,
    E2E_APP_ID: applicationId,
    E2E_GROUP_ID: namespaceId,
    E2E_CONTEXT_GROUP_ID: generalGroupId,
    E2E_CONTEXT_ID: ctx.contextId,
    E2E_MEMBER_KEY: ctx.memberPublicKey,
    // Real tokens from embedded auth: the browser can log in with these.
    E2E_BROWSER_AUTH: "1",
  };
  // Workers are spawned after global setup and inherit its environment.
  Object.assign(process.env, env);
  writeFileSync(STATE_FILE, JSON.stringify({ pids, ...env }, null, 2));
}
