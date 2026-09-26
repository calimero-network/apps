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
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..", "..");
const LOGIC_DIR = path.resolve(APP_DIR, "..", "logic");

export const DATA_DIR = path.resolve(APP_DIR, ".playwright-data");
export const STATE_FILE = path.resolve(DATA_DIR, "state.json");

// Two nodes: Alice's (the one the browser drives) and Bob's, peered, so the
// specs that need a second member — cross-node sync, multi-user rpc — run too.
const NODES = [
  { name: "chat-pw-1", server: Number(process.env.PW_SERVER_PORT) || 2620, swarm: Number(process.env.PW_SWARM_PORT) || 2520 },
  { name: "chat-pw-2", server: (Number(process.env.PW_SERVER_PORT) || 2620) + 1, swarm: (Number(process.env.PW_SWARM_PORT) || 2520) + 1 },
];
const urlOf = (n: (typeof NODES)[number]) => `http://localhost:${n.server}`;
const NODE_URL = urlOf(NODES[0]);

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

async function api<T>(base: string, token: string, method: string, route: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${base}${route}`, {
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

/**
 * Clear the PUBLIC devnet bootstrap peer `init` seeds (left in, startup dials
 * unreachable addresses and a later join dies as `KeyDelivery timed out`), turn
 * mDNS on (opt-in since rc.26), and point node 2 at node 1 explicitly — mDNS on
 * a CI runner is not something to depend on.
 */
function patchConfig(home: string, name: string, bootstrap: string[]) {
  const file = path.join(home, name, "config.toml");
  let text = readFileSync(file, "utf8");
  const list = `[${bootstrap.map((a) => JSON.stringify(a)).join(", ")}]`;
  const before = text;
  text = text.replace(/(\[bootstrap\][^[]*?\bnodes\s*=\s*)\[[^\]]*\]/s, `$1${list}`);
  if (text === before && !before.includes(`nodes = ${list}`)) throw new Error(`no [bootstrap] nodes in ${file}`);
  text = text.replace(/(\bmdns\s*=\s*)(true|false)/, "$1true");
  writeFileSync(file, text);
  return text;
}

function peerIdOf(configText: string): string {
  const m = /\[identity\][^[]*?\bpeer_id\s*=\s*"([^"]+)"/s.exec(configText);
  if (!m) throw new Error("no [identity] peer_id in config.toml");
  return m[1];
}

async function retry<T>(what: string, fn: () => Promise<T>, attempts = 10, delayMs = 3000): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`[real-node] ${what}: attempt ${i}/${attempts} failed — ${String(e).slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`${what} failed after ${attempts} attempts: ${String(last)}`);
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
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const configs: string[] = [];
  for (const n of NODES) {
    execFileSync(
      MEROD,
      [
        "--home", DATA_DIR, "--node", n.name, "init",
        "--server-port", String(n.server), "--swarm-port", String(n.swarm),
        "--auth-mode", "embedded", "--auth-storage", "memory",
      ],
      // `--auth-storage memory` mints the admin from the environment at every
      // start, so the credentials go to both commands.
      { stdio: "pipe", env: { ...process.env, ...ADMIN_ENV } },
    );
  }
  configs.push(patchConfig(DATA_DIR, NODES[0].name, []));
  const peer1 = peerIdOf(configs[0]);
  configs.push(
    patchConfig(DATA_DIR, NODES[1].name, [
      `/ip4/127.0.0.1/tcp/${NODES[0].swarm}/p2p/${peer1}`,
      `/ip4/127.0.0.1/udp/${NODES[0].swarm}/quic-v1/p2p/${peer1}`,
    ]),
  );

  for (const n of NODES) {
    const proc = spawn(MEROD, ["--home", DATA_DIR, "--node", n.name, "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...ADMIN_ENV },
    });
    const log = createWriteStream(path.join(DATA_DIR, `${n.name}.log`));
    proc.stdout?.pipe(log);
    proc.stderr?.pipe(log);
    if (proc.pid) pids.push(proc.pid);
    console.log(`[real-node] ${n.name} started (pid ${proc.pid}) on :${n.server}`);
  }
  // Written now, so teardown stops both nodes even if seeding fails below.
  writeFileSync(STATE_FILE, JSON.stringify({ pids }, null, 2));

  const [url1, url2] = NODES.map(urlOf);
  await Promise.all([waitForHealth(url1), waitForHealth(url2)]);
  const [tok1, tok2] = await Promise.all([authenticate(url1), authenticate(url2)]);
  const t1 = tok1.accessToken;
  const t2 = tok2.accessToken;

  // On BOTH nodes: since rc.31 a node serves no bytecode to peers.
  const [{ applicationId }, installed2] = await Promise.all([
    api<{ applicationId: string }>(url1, t1, "POST", "/admin-api/install-dev-application", { path: MPK }),
    api<{ applicationId: string }>(url2, t2, "POST", "/admin-api/install-dev-application", { path: MPK }),
  ]);
  if (installed2.applicationId !== applicationId) {
    throw new Error(`the two nodes installed different app ids: ${applicationId} vs ${installed2.applicationId}`);
  }

  // The workspace, as CreateWorkspacePopup makes it.
  const { namespaceId } = await api<{ namespaceId: string }>(url1, t1, "POST", "/admin-api/namespaces", {
    applicationId,
    name: "E2E Workspace",
  });
  await api(url1, t1, "PUT", `/admin-api/groups/${namespaceId}/metadata`, { name: "E2E Workspace" });

  // Alice's display name, as the app's Join step writes it: the namespace's
  // member metadata is what the message list resolves a sender to.
  const members1 = await api<{ members: { identity: string }[] }>(url1, t1, "GET", `/admin-api/groups/${namespaceId}/members`);
  const account1 = members1.members[0]?.identity;
  if (!account1) throw new Error("the new workspace lists no member");
  await api(url1, t1, "PUT", `/admin-api/groups/${namespaceId}/members/${account1}/metadata`, { name: "Alice" });

  // #general, as ChannelHeader makes a public channel: subgroup → open → context.
  const { groupId: generalGroupId } = await api<{ groupId: string }>(
    url1,
    t1,
    "POST",
    `/admin-api/namespaces/${namespaceId}/groups`,
    { groupName: "general" },
  );
  await api(url1, t1, "PUT", `/admin-api/groups/${generalGroupId}/settings/subgroup-visibility`, {
    subgroupVisibility: "open",
  });
  const ctx = await api<{ contextId: string; memberPublicKey: string }>(url1, t1, "POST", "/admin-api/contexts", {
    applicationId,
    groupId: generalGroupId,
    name: "general",
    initializationParams: initParams("general", "Alice"),
  });

  console.log(
    `[real-node] app=${applicationId.slice(0, 8)}… workspace=${namespaceId.slice(0, 8)}… ` +
      `#general=${ctx.contextId.slice(0, 8)}… alice=${account1.slice(0, 8)}…`,
  );

  // Bob joins the workspace from node 2 with an invitation, as the app's
  // join-by-invite does, then joins #general. Retried: the peers need a moment.
  const invite = await api<{ invitation: unknown }>(url1, t1, "POST", `/admin-api/namespaces/${namespaceId}/invite`, {});
  await retry("node 2 joins the workspace", () =>
    api(url2, t2, "POST", `/admin-api/namespaces/${namespaceId}/join`, { invitation: invite.invitation }),
  );
  const members2 = await retry("node 2 sees itself as a member", async () => {
    await api(url2, t2, "POST", `/admin-api/groups/${namespaceId}/sync`, {}).catch(() => {});
    const m = await api<{ members: { identity: string }[] }>(url2, t2, "GET", `/admin-api/groups/${namespaceId}/members`);
    if ((m.members ?? []).length < 2) throw new Error(`only ${(m.members ?? []).length} member(s) visible on node 2`);
    return m;
  });
  const account2 = members2.members.map((m) => m.identity).find((id) => id !== account1) ?? "";
  if (account2) {
    await api(url2, t2, "PUT", `/admin-api/groups/${namespaceId}/members/${account2}/metadata`, { name: "Bob" }).catch(
      (e) => console.warn(`[real-node] Bob's name not set (non-fatal): ${e}`),
    );
  }
  const joined = await retry("node 2 joins #general", async () => {
    await api(url2, t2, "POST", `/admin-api/groups/${generalGroupId}/sync`, {}).catch(() => {});
    return api<{ contextId: string; memberPublicKey: string }>(url2, t2, "POST", `/admin-api/contexts/${ctx.contextId}/join`, {});
  });
  console.log(`[real-node] bob=${account2.slice(0, 8)}… joined #general as ${joined.memberPublicKey?.slice(0, 8)}…`);

  const env = {
    E2E_NODE_URL: url1,
    E2E_NODE_URL_2: url2,
    E2E_ACCESS_TOKEN: tok1.accessToken,
    E2E_REFRESH_TOKEN: tok1.refreshToken,
    E2E_ACCESS_TOKEN_2: tok2.accessToken,
    E2E_REFRESH_TOKEN_2: tok2.refreshToken,
    E2E_APP_ID: applicationId,
    E2E_GROUP_ID: namespaceId,
    E2E_CONTEXT_GROUP_ID: generalGroupId,
    E2E_CONTEXT_ID: ctx.contextId,
    E2E_MEMBER_KEY: ctx.memberPublicKey,
    E2E_MEMBER_KEY_2: joined.memberPublicKey ?? "",
    E2E_ACCOUNT_ID: account1,
    E2E_ACCOUNT_ID_2: account2,
    // Real tokens from embedded auth: the browser can log in with these.
    E2E_BROWSER_AUTH: "1",
  };
  // Workers are spawned after global setup and inherit its environment.
  Object.assign(process.env, env);
  writeFileSync(STATE_FILE, JSON.stringify({ pids, ...env }, null, 2));
}
