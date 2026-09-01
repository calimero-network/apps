#!/usr/bin/env node
/**
 * app/e2e/two-node-suite.mjs — prove the whole 2-node path, scenario by scenario.
 *
 * The browser test (`browser-call.mjs`) proves the CALL. It says nothing about how
 * two people get into the same context in the first place, because `dev-invite.sh`
 * did all of that with curl before the browser ever opened. So the parts a second
 * person actually depends on — namespace creation, an open invitation, the join,
 * a room as a subgroup, the context bound to it — had no coverage at all.
 *
 * This suite exercises them against the two live nodes over the admin API, each
 * stage asserted independently so a failure names the stage rather than "the call
 * didn't work". It then emits the two /live URLs for the room it built, which the
 * orchestrator hands to browser-call.mjs — so the stream is proven on a context
 * created THROUGH the invite path, not one pre-baked by a script.
 *
 * Deliberately raw `fetch` rather than mero-js: mero-js is the browser's client and
 * is already exercised there. Here the point is to pin the HTTP contract the app
 * depends on, in the same shape `dev-invite.sh` uses.
 *
 * Usage (from app/):
 *   node e2e/two-node-suite.mjs
 *   node e2e/two-node-suite.mjs --emit-urls /tmp/mero-stream-room-urls.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_FILE = resolve(REPO, "app/.env.dev-call");
const VITE_URL = process.env.VITE_URL ?? "http://127.0.0.1:5199";

const argOf = (f) => {
  const i = process.argv.indexOf(f);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const c = {
  scenario: (n, m) => console.log(`\n\x1b[1;35m▐ S${n}. ${m}\x1b[0m`),
  ok: (m) => console.log(`\x1b[32m  ✓  ${m}\x1b[0m`),
  bad: (m) => console.error(`\x1b[31m  ✗  ${m}\x1b[0m`),
  info: (m) => console.log(`     ${m}`),
};

const results = [];
let current = null;
const scenario = (n, name) => {
  current = { n, name, failures: 0 };
  results.push(current);
  c.scenario(n, name);
};
const check = (cond, msg) => {
  if (cond) c.ok(msg);
  else {
    if (current) current.failures += 1;
    c.bad(msg);
  }
  return cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── env ───────────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const N1 = {
  url: env.DEV_NODE_URL,
  token: env.DEV_ACCESS_TOKEN,
  name: "node1",
};
const N2 = {
  url: env.DEV_NODE_URL_2,
  token: env.DEV_ACCESS_TOKEN_2,
  name: "node2",
};
for (const [k, v] of Object.entries({
  DEV_NODE_URL: N1.url,
  DEV_ACCESS_TOKEN: N1.token,
  DEV_NODE_URL_2: N2.url,
  DEV_ACCESS_TOKEN_2: N2.token,
  DEV_APP_ID: env.DEV_APP_ID,
})) {
  if (!v) {
    c.bad(`${k} missing from ${ENV_FILE} — run scripts/dev-node*.sh first`);
    process.exit(1);
  }
}

/** Admin API call. Returns `{ ok, status, data }` — never throws on a 4xx/5xx. */
async function api(node, method, path, body) {
  const res = await fetch(`${node.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${node.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e) => ({ ok: false, status: 0, _err: String(e) }));
  if (!res.ok && res.status === undefined) return { ok: false, status: 0 };
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body is legal for some calls */
  }
  // The admin API wraps success payloads in `data`.
  return { ok: res.ok, status: res.status, data: json?.data ?? json };
}

/**
 * Unwrap an invitation until we reach the object that actually carries
 * `inviter_signature`. The join endpoint wants the invitation OBJECT, not a JSON
 * string of it and not a wrapper around it — the same trap dev-invite.sh hit.
 */
function unwrapInvitation(payload) {
  let node = payload;
  for (let i = 0; i < 5; i++) {
    if (!node || typeof node !== "object") return null;
    if ("inviter_signature" in node) return node;
    if ("invitation" in node) node = node.invitation;
    else return null;
  }
  return null;
}

async function main() {
  // ── S1: the baseline harness is actually sane ──────────────────────────────
  scenario(1, "Baseline: both nodes healthy, app installed, context shared");
  for (const n of [N1, N2]) {
    const h = await api(n, "GET", "/admin-api/health");
    check(h.ok, `${n.name} is healthy`);
  }
  for (const n of [N1, N2]) {
    const apps = await api(n, "GET", "/admin-api/applications");
    const ids = (apps.data?.apps ?? apps.data?.applications ?? []).map(
      (a) => a.id,
    );
    check(
      ids.includes(env.DEV_APP_ID),
      `${n.name} has the app installed (${env.DEV_APP_ID.slice(0, 8)}…)`,
    );
  }
  // Both nodes must hold an identity in the SHARED context — read from each node's
  // OWN API, which is the actual Calimero claim.
  for (const n of [N1, N2]) {
    const owned = await api(
      n,
      "GET",
      `/admin-api/contexts/${env.DEV_CONTEXT_ID}/identities-owned`,
    );
    const list = Array.isArray(owned.data)
      ? owned.data
      : (owned.data?.identities ?? []);
    check(list.length > 0, `${n.name} holds an identity in the shared context`);
  }

  // ── S2: namespace invitation → join, from scratch ──────────────────────────
  scenario(2, "Namespace: create on node1, invite, node2 joins");
  const nsRes = await api(N1, "POST", "/admin-api/namespaces", {
    applicationId: env.DEV_APP_ID,
    upgradePolicy: "LazyOnAccess",
    alias: `suite-ns-${Date.now()}`,
  });
  const namespaceId =
    nsRes.data?.namespaceId ?? nsRes.data?.groupId ?? nsRes.data?.id;
  if (!check(!!namespaceId, `node1 created a namespace (${namespaceId})`)) {
    return finish();
  }

  // Members need capabilities or node2 can join and then do nothing useful.
  const caps = await api(
    N1,
    "PUT",
    `/admin-api/groups/${namespaceId}/settings/default-capabilities`,
    { defaultCapabilities: 15 },
  );
  check(caps.ok, "default member capabilities set (15 = all base caps)");

  const invRes = await api(
    N1,
    "POST",
    `/admin-api/namespaces/${namespaceId}/invite`,
    {},
  );
  const invitation = unwrapInvitation(invRes.data);
  // An OPEN invitation carries no invitee key — anyone holding it can join. Passing
  // `inviteePublicKey` here is silently ignored and misleads the next reader.
  if (
    !check(
      !!invitation,
      "node1 minted an OPEN invitation (carries inviter_signature)",
    )
  ) {
    return finish();
  }

  const joinRes = await api(
    N2,
    "POST",
    `/admin-api/namespaces/${namespaceId}/join`,
    { invitation },
  );
  const joinedGroup = joinRes.data?.groupId ?? joinRes.data?.group_id;
  check(
    joinRes.ok && joinedGroup === namespaceId,
    `node2 joined the namespace (member ${String(
      joinRes.data?.memberIdentity ?? joinRes.data?.member_identity,
    ).slice(0, 8)}…)`,
  );

  // Verify from node2's OWN view, not node1's — the whole point of replication.
  let seenByNode2 = false;
  for (let i = 0; i < 20 && !seenByNode2; i++) {
    const g = await api(N2, "GET", `/admin-api/groups/${namespaceId}`);
    seenByNode2 = g.ok;
    if (!seenByNode2) await sleep(1000);
  }
  check(seenByNode2, "node2's own API resolves the namespace it joined");

  // ── S3: a ROOM is a subgroup, with its own context ─────────────────────────
  scenario(3, "Room: subgroup inside the namespace + a context bound to it");
  const roomName = `room-${Date.now()}`;
  const sgRes = await api(
    N1,
    "POST",
    `/admin-api/namespaces/${namespaceId}/groups`,
    { name: roomName },
  );
  const roomId = sgRes.data?.groupId;
  if (
    !check(
      !!roomId,
      `node1 created a room as a SUBGROUP of the namespace (${roomId})`,
    )
  ) {
    return finish();
  }

  // OPEN, so a namespace member can admit ITSELF into the room instead of needing
  // a second admin round-trip per room. `VisibilityMode` is Open | Restricted in
  // core, and RESTRICTED IS THE DEFAULT — which is exactly why this failed before:
  // node2 held the namespace, the room existed, and node2 still could not reach the
  // room's context (join-via-inheritance returned 403).
  //
  // The wire value is lowercase. Core rejects "Open" with
  //   Field 'subgroup_visibility' has invalid format: must be 'open' or 'restricted'
  // which is a good error — but the TS type is a bare `string`, so nothing catches
  // the casing at compile time.
  const vis = await api(
    N1,
    "PUT",
    `/admin-api/groups/${roomId}/settings/subgroup-visibility`,
    { subgroupVisibility: "open" }, // lowercase: core rejects "Open"
  );
  check(vis.ok, `room subgroup set to open (HTTP ${vis.status})`);
  const info = await api(N1, "GET", `/admin-api/groups/${roomId}`);
  check(
    String(info.data?.subgroupVisibility ?? "").toLowerCase() === "open",
    `visibility reads back as Open (got ${info.data?.subgroupVisibility})`,
  );

  const listed = await api(
    N1,
    "GET",
    `/admin-api/namespaces/${namespaceId}/groups`,
  );
  const rooms = Array.isArray(listed.data)
    ? listed.data
    : (listed.data?.groups ?? []);
  check(
    rooms.some((r) => r.groupId === roomId),
    `the room is listed under its namespace (${rooms.length} room(s))`,
  );

  // The contract's init(name) takes JSON bytes — same as StreamsPage does.
  const initializationParams = Array.from(
    new TextEncoder().encode(JSON.stringify({ name: roomName })),
  );
  const ctxRes = await api(N1, "POST", "/admin-api/contexts", {
    applicationId: env.DEV_APP_ID,
    protocol: "near",
    groupId: roomId, // bound to the SUBGROUP, not the namespace
    alias: roomName,
    initializationParams,
  });
  const roomContextId = ctxRes.data?.contextId ?? ctxRes.data?.id;
  const n1Member =
    ctxRes.data?.memberPublicKey ?? ctxRes.data?.member_public_key;
  if (
    !check(
      !!roomContextId,
      `context created inside the room subgroup (${roomContextId})`,
    )
  ) {
    return finish();
  }
  check(!!n1Member, `node1 has an identity in the room context`);

  // ── S4: node2 reaches the room's context without another admin round ───────
  scenario(4, "Node2 self-admits into the room and reaches its context");
  // Self-admit into the OPEN subgroup. This is the step that was missing: joining a
  // namespace does NOT put you in its rooms, and without it node2 can see the
  // namespace but never the room's context.
  const inherit = await api(
    N2,
    "POST",
    `/admin-api/groups/${roomId}/join-via-inheritance`,
    {},
  );
  check(
    inherit.ok,
    `node2 joined the room via inheritance (HTTP ${inherit.status})`,
  );

  let n2Member = null;
  for (let i = 0; i < 30 && !n2Member; i++) {
    const owned = await api(
      N2,
      "GET",
      `/admin-api/contexts/${roomContextId}/identities-owned`,
    );
    const list = Array.isArray(owned.data)
      ? owned.data
      : (owned.data?.identities ?? owned.data?.items ?? []);
    if (list.length > 0 && list[0]) n2Member = list[0];
    if (!n2Member) await sleep(2000);
  }

  if (!n2Member) {
    // Auto-follow is not instant and is not guaranteed; fall back to an explicit
    // join, exactly as dev-invite.sh has to.
    c.info("auto-follow did not carry it — joining the context explicitly");
    const ident = await api(N2, "POST", "/admin-api/identity/context", {});
    const pk = ident.data?.publicKey ?? ident.data?.public_key;
    const cj = await api(
      N2,
      "POST",
      `/admin-api/contexts/${roomContextId}/join`,
      { inviteePublicKey: pk },
    );
    n2Member = cj.data?.memberPublicKey ?? cj.data?.member_public_key ?? null;
  }
  check(!!n2Member, `node2 holds an identity in the room context`);

  if (n2Member && n1Member) {
    check(
      n1Member !== n2Member,
      "the two nodes hold DISTINCT identities (not the same key twice)",
    );
  }

  // ── Emit the URLs for the browser stream test ──────────────────────────────
  const emit = argOf("--emit-urls");
  if (emit && roomContextId && n1Member && n2Member) {
    const hash = (nodeUrl, token, refresh, appId, member) =>
      `#node_url=${nodeUrl}&access_token=${token}&refresh_token=${refresh}` +
      `&app-id=${appId}&context_id=${roomContextId}` +
      `&executor_public_key=${member}&dev_mode=1`;
    const urls = [
      `${VITE_URL}/live${hash(N1.url, N1.token, env.DEV_REFRESH_TOKEN, env.DEV_APP_ID, n1Member)}`,
      "",
      `${VITE_URL}/live${hash(N2.url, N2.token, env.DEV_REFRESH_TOKEN_2, env.DEV_APP_ID_2 || env.DEV_APP_ID, n2Member)}`,
    ].join("\n");
    writeFileSync(emit, urls + "\n");
    c.ok(`wrote /live URLs for the new room to ${emit}`);
    c.info(
      "the browser stream test now runs on a context built via the invite",
    );
  }

  return finish();
}

function finish() {
  console.log("\n\x1b[1;35m▐ Summary\x1b[0m");
  let bad = 0;
  for (const r of results) {
    const status =
      r.failures === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`  S${r.n}  ${status}  ${r.name}`);
    bad += r.failures;
  }
  if (bad > 0) {
    c.bad(`${bad} check(s) failed`);
    process.exit(1);
  }
  c.ok("all scenarios passed");
}

main().catch((e) => {
  c.bad(e.stack ?? String(e));
  process.exit(1);
});
