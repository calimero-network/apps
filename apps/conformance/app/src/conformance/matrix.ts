/**
 * The 1.0 matrix: every call a component app's client (mero-js `CalimeroClient`)
 * makes, on a 1.0 cluster, with one row per check.
 *
 * The 0.x matrix ran every admin and RPC call mero-react makes twice, once on
 * a node connection and once on an account behind a relay, because the two
 * paths differed. On 1.0 there is one path: every person is an account with a
 * passkey, every node of the cluster serves every account, and requests are
 * sealed to an attested node. So there is one run, with two accounts on
 * different nodes, and the "mode" axis becomes WHO calls: account A (the run's
 * subject, which founds everything), account B (invited into A's org, reads
 * what A wrote and writes for A to read), an outsider, an anonymous client and
 * an API key. A row expects `ok`, or a refusal the node names (`NOT_FOUND`,
 * `CONFIRM_REQUIRED`, `FORBIDDEN`, an app's own `APP_ERROR:<code>`, …); a bare
 * failure, a wrong value read back or a timeout never passes.
 *
 * Phases, in order (README "The 1.0 matrix" maps each to its 0.x rows):
 *
 *   accounts   signUp A and B on different nodes, me, signIn on a third node,
 *              refresh, attestation, usage, passkey label/add/remove
 *   packages   uploadBundle, uploadPackage x2 (+ a forged one refused),
 *              packages, package, installPackage (NO_REGISTRY: dev cluster)
 *   orgs       createOrg, getOrg, setOrgMetadata, teams (open, invite-only,
 *              moved), updateTeam, setCapabilities, invite, B redeems
 *   apps       createApp (bundle, package, team), listApps, getApp,
 *              setAppMetadata, appStorage, appAbi, aliases
 *   calls      one write and read-back per storage kind as A; B reads A's
 *              writes and writes its own; idempotency, stale views, the
 *              passkey step-up, typed errors and a trap
 *   access     outsider, anonymous, public access, accounts access, team
 *              access, API keys (read-only refused a write)
 *   members    setMember (promote, demote), team rows and capabilities,
 *              member metadata
 *   live       events and presence, each account hearing the other
 *   blobs      upload, info, list, download (A, then B), refused to another
 *              app, delete
 *   upgrades   upgradeApp (step-up), upgradeOrg + upgradeRun +
 *              retryUpgradeRun, releaseRules, pendingApprovals, appsReport,
 *              approveRelease, approveOutbound
 *   teardown   transferApp, B leaves the org, deleteApp, deleteTeam,
 *              uninstallPackage, deleteOrg, signOut, signOutEverywhere
 */
import {
  passkeyConfirm,
  presenceState,
  ORG_CAPABILITIES,
  orgCapabilities,
  type CalimeroClient,
  type NodeEvent,
  type PasskeyProvider,
} from "@calimero-network/mero-js";

import { OK, appError, assert, check, eventually as waitFor, need, short, sleep, untilRefused as refusedWithin, type Recorder } from "./check";
import { PACKAGE, contract } from "./contract";
import { publisher, signedMpk, variant } from "./mpk";
import type { Row, Who } from "./types";
import { listAppInfos } from "@calimero-apps/connect";

/** What the matrix runs on. The page and the cluster run each make one. */
export interface MatrixEnv {
  /** A new client whose first node is node `i` (mod the cluster's size), with no session. */
  client(i: number): Promise<CalimeroClient>;
  /** A fresh passkey the cluster trusts (a software one in the run and the page). */
  passkey(): PasskeyProvider;
  /** The built component (`logic/res/conformance.wasm`). */
  wasm: Uint8Array;
  /** Called with every row as it is recorded. */
  onRow?(row: Row): void;
  /** A suffix for this run's names (package, org, apps, aliases). */
  tag?: string;
  /** The `minRuntimeVersion` the matrix's packages declare. */
  minRuntimeVersion?: string;
  /** How long a row waits for what lands a moment later (default 20 s). */
  patienceMs?: number;
}

interface Person {
  who: Who;
  client: CalimeroClient;
  passkey: PasskeyProvider;
  account?: string;
}

const lower = (x: unknown) => String(x ?? "").toLowerCase();
/** A fresh attestation nonce: 32 random bytes, hex (what mero-js's `attestation()` sent). */
const freshNonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Listen to `app`'s events from `from` until `stop()`, keeping what arrives. */
function listen(
  stream: (signal: AbortSignal) => AsyncGenerator<NodeEvent>,
): { seen: NodeEvent[]; failed: () => unknown; stop(): void } {
  const seen: NodeEvent[] = [];
  const abort = new AbortController();
  let failure: unknown;
  void (async () => {
    try {
      for await (const event of stream(abort.signal)) seen.push(event);
    } catch (e) {
      if (!abort.signal.aborted) failure = e;
    }
  })();
  return { seen, failed: () => failure, stop: () => abort.abort() };
}

async function heardWithin(
  log: { seen: NodeEvent[]; failed: () => unknown },
  ok: (e: NodeEvent) => boolean,
  what: string,
  timeoutMs: number,
): Promise<NodeEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = log.seen.find(ok);
    if (hit) return hit;
    const failure = log.failed();
    if (failure) throw failure;
    if (Date.now() > deadline) {
      throw Object.assign(new Error(`${what}: not heard in ${timeoutMs} ms (heard ${short(log.seen.map((e) => e.kind))})`), {
        name: "Mismatch",
      });
    }
    await sleep(100);
  }
}

/** Runs the whole matrix and resolves with every row; never rejects for a failed row. */
export async function runMatrix(env: MatrixEnv): Promise<Row[]> {
  const rows: Row[] = [];
  const rec: Recorder = {
    record(row) {
      rows.push(row);
      env.onRow?.(row);
    },
  };
  const tag = env.tag ?? Math.random().toString(36).slice(2, 8);
  const patience = env.patienceMs ?? 20_000;
  const eventually = <T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = patience) => waitFor(fn, ok, what, ms);
  const untilRefused = (fn: () => Promise<unknown>, what: string) => refusedWithin(fn, what, patience);
  const heard = (log: Parameters<typeof heardWithin>[0], ok: (e: NodeEvent) => boolean, what: string) => heardWithin(log, ok, what, patience);
  const pkg = `${PACKAGE}.run-${tag}`;

  const A: Person = { who: "A", client: await env.client(0), passkey: env.passkey() };
  const B: Person = { who: "B", client: await env.client(1), passkey: env.passkey() };
  const C: Person = { who: "outsider", client: await env.client(2), passkey: env.passkey() };
  const row = <T>(p: Person | Who, area: string, name: string, expected: string, fn: () => Promise<T>, show?: (v: T) => unknown) =>
    check(rec, typeof p === "string" ? p : p.who, area, name, expected, fn, show);

  // ── accounts ──────────────────────────────────────────────────────────────
  const ACC = "Accounts";
  for (const p of [A, B, C]) {
    const s = await row(p, ACC, "signUp", OK, () => p.client.signUp(p.passkey, `conformance-${p.who}-${tag}`), (s) => s.accountId);
    p.account = s?.accountId;
  }
  const me = await row(A, ACC, "me", OK, async () => {
    const m = await A.client.auth.me();
    assert(m.accountId === need(A.account, "A's account"), `me() is ${short(m.accountId)}, signed up as ${A.account}`);
    return m;
  }, (m) => ({ accountId: m.accountId, via: m.via }));
  const elsewhere = await env.client(2);
  await row(A, ACC, "signIn (the same passkey, another node)", OK, async () => {
    const s = await elsewhere.signIn(A.passkey);
    assert(s.accountId === need(A.account, "A's account"), `signed in as ${s.accountId}, not ${A.account}`);
    return s;
  }, (s) => s.accountId);
  // A refresh token younger than an hour is kept (core#4873, 1.0.0-rc.11): the
  // refresh mints a session token and hands the same refresh token back, with no
  // system-log write. An older one is exchanged, as before.
  await row(A, ACC, "refresh (a young refresh token is kept)", OK, async () => {
    const before = need(A.client.session, "A's session").refreshToken;
    const s = await A.client.refresh();
    assert(s.refreshToken === before, "a young refresh token was exchanged");
    assert(s.accountId === A.account, `refreshed as ${short(s.accountId)}`);
    return s;
  }, (s) => ({ expiresAt: s.expiresAt }));
  await row(
    A,
    ACC,
    "attestation",
    OK,
    () => A.client.public.attestation({ nonce: freshNonce() }),
    (d) => ({ mock: (d as { mock?: unknown }).mock }),
  );
  await row(A, ACC, "usage", OK, () => A.client.auth.usage(), (u) => Object.keys(u));
  await row(A, ACC, "labelPasskey", OK, () =>
    A.client.auth.passkeyLabel({ cred: need(me?.passkeyId as string | undefined, "A's passkey id"), label: "conformance" }));
  const device = env.passkey();
  // Approving with the passkey being added is refused before anything is
  // written: no account has that credential yet, which the node answers
  // PASSKEY_UNKNOWN_HERE (core#4872, 1.0.0-rc.11; it was UNKNOWN_CHALLENGE).
  await row(A, ACC, "addPasskey (approved by the new passkey itself)", "PASSKEY_UNKNOWN_HERE", () => A.client.addPasskey(device, device));
  const cred = await row(A, ACC, "addPasskey (approved by the account's passkey)", OK, () => A.client.addPasskey(device, A.passkey), (c) => c);
  await row(A, ACC, "signIn (the added passkey)", OK, async () => {
    const s = await (await env.client(1)).signIn(device);
    assert(s.accountId === A.account, `the added passkey signs in as ${s.accountId}`);
    return s;
  }, (s) => s.accountId);
  await row(A, ACC, "removePasskey (without the step-up)", "CONFIRM_REQUIRED", () =>
    A.client.auth.passkeyRemove({ cred: need(cred, "the added passkey") }));
  await row(A, ACC, "removePasskey", OK, () =>
    A.client.auth.passkeyRemove({ cred: need(cred, "the added passkey") }, { confirm: passkeyConfirm(A.passkey) }),
  );

  // ── packages ──────────────────────────────────────────────────────────────
  const PKG = "Packages";
  const bundle = await row(
    A,
    PKG,
    "uploadBundle (the component, raw)",
    OK,
    () => A.client.packages.bundlePut({ body: env.wasm, contentType: "application/wasm" }).then((r) => r.hash),
    (h) => h,
  );
  const key = await publisher();
  const floor = env.minRuntimeVersion ?? "1.0.0-rc.8";
  await row(A, PKG, "uploadPackage (not a package)", "BAD_PACKAGE", () =>
    A.client.packages.upload({ body: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream" }),
  );
  for (const version of ["0.0.0", "0.0.1"]) {
    await row(A, PKG, `uploadPackage (${version})`, OK, async () => {
      const r = await A.client.packages.upload({
        body: await signedMpk(pkg, version, variant(env.wasm, `${tag}-${version}`), key, floor),
        contentType: "application/octet-stream",
      });
      assert(r.package === pkg && r.version === version && r.signerId === key.signerId, `installed ${short(r)}`);
      return r;
    }, (r) => ({ version: r.version, signerId: r.signerId }));
  }
  await row(A, PKG, "uploadPackage (another key, the same package)", "FORBIDDEN", async () =>
    A.client.packages.upload({ body: await signedMpk(pkg, "0.0.2", variant(env.wasm, `${tag}-forged`), await publisher(), floor), contentType: "application/octet-stream" }));
  await row(A, PKG, "packages", OK, async () => {
    const list = (await A.client.packages.list()).packages;
    assert(list.some((p) => p.package === pkg), `${pkg} is not listed`);
    return list;
  }, (l) => `${l.length} packages`);
  await row(A, PKG, "package", OK, async () => {
    const p = await A.client.packages.get({ package: pkg });
    assert(p.latest === "0.0.1", `latest is ${p.latest}`);
    return p;
  }, (p) => ({ latest: p.latest, versions: p.versions.map((v) => v.version) }));
  await row(A, PKG, "installPackage (a development cluster has no registry)", "NO_REGISTRY", () =>
    A.client.packages.install({ package: pkg, version: "0.0.1" }));

  // ── orgs and teams ────────────────────────────────────────────────────────
  const ORG = "Orgs";
  const TEAM = "Teams";
  const org = await row(
    A,
    ORG,
    "createOrg",
    OK,
    () => A.client.orgs.create({ name: `conformance-${tag}` }).then((r) => r.orgId),
    (o) => o,
  );
  const orgId = () => need(org, "an org");
  await row(A, ORG, "getOrg", OK, async () => {
    const o = await A.client.orgs.get({ org: orgId() });
    assert(o.orgId === org, `getOrg answers ${short(o.orgId)}`);
    assert(Object.hasOwn((o.members ?? {}) as object, need(A.account, "A's account")), "A is not a member of its own org");
    return o;
  }, (o) => ({ members: Object.keys((o.members ?? {}) as object).length, releaseApprovers: o.releaseApprovers?.length }));
  await row(A, ORG, "setOrgMetadata", OK, () =>
    A.client.orgs.metadata({ org: orgId(), metadata: { name: `Conformance ${tag}` } }),
  );
  const open = await row(
    A,
    TEAM,
    "createTeam (open)",
    OK,
    () => A.client.orgs.teamCreate({ org: orgId(), name: `open-${tag}`, join: "everyone" }).then((r) => r.teamId),
    (t) => t,
  );
  const closed = await row(
    A,
    TEAM,
    "createTeam (invite-only)",
    OK,
    () => A.client.orgs.teamCreate({ org: orgId(), name: `closed-${tag}`, join: "invite" }).then((r) => r.teamId),
    (t) => t,
  );
  const moved = await row(
    A,
    TEAM,
    "createTeam (to move)",
    OK,
    () => A.client.orgs.teamCreate({ org: orgId(), name: `moved-${tag}`, join: "invite" }).then((r) => r.teamId),
    (t) => t,
  );
  await row(A, TEAM, "getTeam", OK, async () => {
    const t = await A.client.orgs.teamGet({ org: orgId(), team: need(closed, "a team") });
    assert(t.teamId === closed, `getTeam answers ${short(t.teamId)}`);
    return t;
  }, (t) => ({ name: t.name, join: t.join }));
  await row(A, TEAM, "updateTeam (name, metadata)", OK, async () => {
    await A.client.orgs.teamUpdate({
      org: orgId(),
      team: need(closed, "a team"),
      name: `renamed-${tag}`,
      metadata: { colour: "teal" },
    });
    const t = await A.client.orgs.teamGet({ org: orgId(), team: need(closed, "a team") });
    assert(t.name === `renamed-${tag}`, `the team is called ${short(t.name)}`);
  });
  await row(A, TEAM, "updateTeam (parent: move under another team)", OK, async () => {
    await A.client.orgs.teamUpdate({
      org: orgId(),
      team: need(moved, "a team to move"),
      parent: need(closed, "a parent"),
    });
    const t = await A.client.orgs.teamGet({ org: orgId(), team: need(moved, "a team to move") });
    assert(t.parent === closed, `the team's parent is ${short(t.parent)}`);
  });
  await row(A, TEAM, "updateTeam (join: everyone)", OK, () =>
    A.client.orgs.teamUpdate({ org: orgId(), team: need(moved, "a team"), join: "everyone" }),
  );
  await row(A, ORG, "setCapabilities (the org's default, approved)", OK, () =>
    A.client.orgs.capabilities({ org: orgId(), capabilities: orgCapabilities("CREATE_APP", "INVITE_MEMBERS", "JOIN_OPEN_TEAMS") }, { confirm: passkeyConfirm(A.passkey) }));
  await row(A, ORG, "invite (without the step-up)", "CONFIRM_REQUIRED", () =>
    A.client.orgs.inviteCreate({ org: orgId(), role: "member" }));
  const invite = await row(
    A,
    ORG,
    "invite (member)",
    OK,
    () =>
      A.client.orgs
        .inviteCreate({ org: orgId(), role: "member", teams: [] }, { confirm: passkeyConfirm(A.passkey) })
        .then((r) => r.token),
    () => "a token",
  );
  await row(
    B,
    ORG,
    "redeemInvite",
    OK,
    () => B.client.orgs.inviteRedeem({ token: need(invite, "an invite") }),
    (r) => r,
  );
  // A one-use invite is gone once redeemed: the system log rejects the redemption.
  await row(B, ORG, "redeemInvite (again: one use)", "REJECTED", () =>
    B.client.orgs.inviteRedeem({ token: need(invite, "an invite") }),
  );
  await row(B, ORG, "getOrg (second account)", OK, async () => {
    const o = await eventually(
      () => B.client.orgs.get({ org: orgId() }),
      (o) => Object.hasOwn((o.members ?? {}) as object, need(B.account, "B's account")),
      "B listed as a member",
    );
    return o;
  }, (o) => Object.keys((o.members ?? {}) as object).length);
  await row(C, ORG, "getOrg (an outsider)", "NOT_FOUND", () => C.client.orgs.get({ org: orgId() }));
  await row(B, ORG, "setMemberMetadata (its own)", OK, () =>
    B.client.orgs.memberMetadata({
      org: orgId(),
      account: need(B.account, "B's account"),
      metadata: { title: "second" },
    }),
  );
  await row(A, ORG, "setMemberMetadata (another member's, cleared)", OK, () =>
    A.client.orgs.memberMetadata({ org: orgId(), account: need(B.account, "B's account"), metadata: null }),
  );
  await row(A, ORG, "invite (guest, a team, one use, an hour)", OK, () =>
    A.client.orgs.inviteCreate({ org: orgId(), role: "guest", teams: [need(closed, "a team")], ttlSecs: 3600, uses: 1 }, { confirm: passkeyConfirm(A.passkey) }).then((r) => r.token), () => "a token");

  // ── apps ──────────────────────────────────────────────────────────────────
  const APPS = "Apps";
  const app = await row(A, APPS, "createApp (a bundle, in the org)", OK, () =>
    A.client.apps.create({ name: `main-${tag}`, bundle: need(bundle, "a bundle"), org: orgId() }).then((r) => r.appId), (a) => a);
  const appId = () => need(app, "the main app");
  const fromPkg = await row(A, APPS, "createApp (a package release, in the org)", OK, () =>
    A.client.apps.create({ name: `pkg-${tag}`, package: pkg, version: "0.0.0", org: orgId() }).then((r) => r.appId), (a) => a);
  const forRun = await row(A, APPS, "createApp (a package release, for the org run)", OK, () =>
    A.client.apps.create({ name: `run-${tag}`, package: pkg, version: "0.0.0", org: orgId() }).then((r) => r.appId), (a) => a);
  const inOpen = await row(A, APPS, "createApp (the open team's)", OK, () =>
    A.client.apps.create({ name: `open-${tag}`, bundle: need(bundle, "a bundle"), org: orgId(), access: { kind: "team", team: need(open, "the open team") } }).then((r) => r.appId), (a) => a);
  const inClosed = await row(A, APPS, "createApp (the invite-only team's)", OK, () =>
    A.client.apps.create({ name: `closed-${tag}`, bundle: need(bundle, "a bundle"), org: orgId(), access: { kind: "team", team: need(closed, "the invite-only team") } }).then((r) => r.appId), (a) => a);
  const own = await row(
    A,
    APPS,
    "createApp (A's own, no org)",
    OK,
    () => A.client.apps.create({ name: `own-${tag}`, bundle: need(bundle, "a bundle") }).then((r) => r.appId),
    (a) => a,
  );
  await row(A, APPS, "listApps", OK, async () => {
    const list = await listAppInfos(A.client);
    for (const id of [app, fromPkg, own]) assert(list.some((x) => x.appId === id), `${short(id)} is not listed`);
    return list;
  }, (l) => `${l.length} apps`);
  await row(A, APPS, "listApps ({ bundle })", OK, async () => {
    const list = await listAppInfos(A.client, { bundle: need(bundle, "a bundle") });
    assert(list.some((x) => x.appId === app), "the main app is not listed by its bundle");
    return list;
  }, (l) => `${l.length} apps`);
  await row(A, APPS, "listApps ({ package })", OK, async () => {
    const list = await listAppInfos(A.client, { package: pkg });
    const mine = list.find((x) => x.appId === fromPkg);
    assert(mine?.version === "0.0.0", `the package's app is listed at ${short(mine)}`);
    return list;
  }, (l) => `${l.length} apps`);
  await row(B, APPS, "listApps (second account: the org's apps)", OK, async () => {
    const list = await eventually(
      () => listAppInfos(B.client),
      (l) => l.some((x) => x.appId === app),
      "the org's app listed for B",
    );
    assert(!list.some((x) => x.appId === own), "B is shown A's own app");
    return list;
  }, (l) => `${l.length} apps`);
  await row(A, APPS, "getApp", OK, async () => {
    const a = await A.client.apps.get({ app: appId() });
    assert(a.owner === A.account && a.org === org, `getApp: owner ${short(a.owner)}, org ${short(a.org)}`);
    return a;
  }, (a) => ({ owner: short(a.owner, 12), org: short(a.org, 12) }));
  await row(A, APPS, "setAppMetadata", OK, () =>
    A.client.apps.metadata({ app: appId(), metadata: { title: `Conformance ${tag}` } }),
  );
  await row(A, APPS, "appAbi", OK, async () => {
    const r = await A.client.apps.abi({ app: appId() });
    const methods = ((r.abi as { methods?: object } | undefined)?.methods ?? {}) as Record<string, unknown>;
    assert("confirmedSet" in methods && "myAccount" in methods, `the ABI lists ${short(Object.keys(methods))}`);
    return r;
  }, (r) => ({ bundle: r.bundle }));
  const ALIAS = "Aliases";
  const alias = `conformance-${tag}`;
  await row(A, ALIAS, "setAlias", OK, () => A.client.auth.aliasSet({ alias, app: appId() }));
  await row(A, ALIAS, "alias", OK, async () => {
    const r = (await A.client.auth.aliasGet({ alias })).appId;
    assert(r === app, `${alias} names ${short(r)}`);
    return r;
  }, (r) => r);
  await row(A, ALIAS, "aliases", OK, async () => {
    const r = (await A.client.auth.aliasList()).aliases;
    assert(r[alias] === app, `the listing has ${alias} as ${short(r[alias])}`);
    return r;
  }, (r) => `${Object.keys(r).length} aliases`);
  await row(A, ALIAS, "deleteAlias", OK, async () => {
    await A.client.auth.aliasDelete({ alias });
    const r = (await A.client.auth.aliasList()).aliases;
    assert(!(alias in r), `${alias} is still listed`);
  });
  await row(B, ALIAS, "alias (another account's name)", "NOT_FOUND", () =>
    B.client.auth.aliasGet({ alias }).then((r) => r.appId),
  );

  // ── calls ─────────────────────────────────────────────────────────────────
  const CALL = "Calls";
  // Built per row, so a missing app blocks the row instead of stopping the matrix.
  const a = () => contract(A.client, appId());
  const b = () => contract(B.client, appId());
  // Opened before anything is written, so every write below is heard (live).
  const aHears = listen((signal) => A.client.events(appId(), 0, signal));
  const bHears = listen((signal) => B.client.events(appId(), 0, signal));

  const first = await row(A, CALL, "call (set, with an idempotency key)", OK, () =>
    A.client.apps.call({ app: appId(), method: "set", args: { key: "conformance", value: `pub-${tag}` }, idempotencyKey: `set-${tag}` }), (r) => ({ index: r.index, events: r.events.map((e) => e.kind) }));
  await row(A, CALL, "call (the same key again: answered once)", OK, async () => {
    const r = await A.client.apps.call({
      app: appId(),
      method: "set",
      args: { key: "conformance", value: "other" },
      idempotencyKey: `set-${tag}`,
    });
    assert(r.index === first?.index, `a retry was applied again at ${r.index} (first ${first?.index})`);
    assert((await a().get("conformance")) === `pub-${tag}`, "the retry's arguments were applied");
    return r;
  }, (r) => r.index);
  await row(A, CALL, "view (get)", OK, async () => {
    const v = await a().get("conformance");
    assert(v === `pub-${tag}`, `read ${short(v)}`);
    return v;
  }, (v) => v);
  await row(B, CALL, "view (stale, at least the write's index, another node)", OK, async () => {
    const r = await B.client.apps.view({
      app: appId(),
      method: "get",
      args: { key: "conformance" },
      consistency: "stale",
      minIndex: need(first, "the write").index,
    });
    assert(r.result === `pub-${tag}`, `read ${short(r.result)}`);
    return r;
  }, (r) => r.result);
  await row(A, CALL, "view (len: a u64 as a decimal string)", OK, async () => {
    const n = await a().len();
    assert(n === 1, `len is ${n}`);
    return n;
  }, (n) => n);
  const myA = await row(A, CALL, "myAccount", OK, async () => {
    const m = await a().myAccount();
    assert(m === A.account, `the contract runs as ${m}, the session is ${A.account}`);
    return m;
  }, (m) => m);
  const myB = await row(B, CALL, "myAccount (second account)", OK, async () => {
    const m = await b().myAccount();
    assert(m === B.account, `the contract runs as ${m}, the session is ${B.account}`);
    return m;
  }, (m) => m);
  await row(A, CALL, "user: setUserSimple", OK, () => a().setUserSimple(`user-${tag}`));
  await row(A, CALL, "user: getUserSimple", OK, async () => {
    const v = await a().getUserSimple();
    assert(v === `user-${tag}`, `read ${short(v)}`);
    return v;
  }, (v) => v);
  await row(B, CALL, "user: getUserSimple (B wrote none)", OK, async () => {
    const v = await b().getUserSimple();
    assert(v === null, `B reads ${short(v)}`);
    return v;
  });
  await row(B, CALL, "user: getUserSimpleFor (A's slot)", OK, async () => {
    const v = await b().getUserSimpleFor(need(myA, "A's account"));
    assert(v === `user-${tag}`, `read ${short(v)}`);
    return v;
  }, (v) => v);
  const hash = await row(A, CALL, "frozen: addFrozen", OK, () => a().addFrozen(`frozen-${tag}`), (h) => h);
  await row(B, CALL, "frozen: getFrozen (A's)", OK, async () => {
    const v = await b().getFrozen(need(hash, "a frozen hash"));
    assert(v === `frozen-${tag}`, `read ${short(v)}`);
    return v;
  }, (v) => v);
  await row(A, CALL, "frozen: getFrozen (no such hash)", appError("FrozenNotFound"), () => a().getFrozen("0".repeat(64)));
  await row(A, CALL, "authored map: authoredInsert", OK, () => a().authoredInsert("primary", "by A"));
  await row(B, CALL, "authored map: A's entry names A", OK, async () => {
    const owner = await b().authoredGetOwner("primary");
    assert(owner === need(myA, "A's account"), `owned by ${short(owner)}`);
    return owner;
  }, (o) => o);
  await row(B, CALL, "authored map: authoredUpdate (A's entry)", appError("NotAuthor"), () => b().authoredUpdate("primary", "by B"));
  await row(B, CALL, "authored map: authoredInsert (second account)", OK, () => b().authoredInsert("second", "by B"));
  await row(A, CALL, "authored map: B's entry names B", OK, async () => {
    const owner = await a().authoredGetOwner("second");
    assert(owner === need(myB, "B's account"), `owned by ${short(owner)}`);
    return owner;
  }, (o) => o);
  await row(A, CALL, "authored map: authoredUpdate, authoredRemove (its own)", OK, async () => {
    await a().authoredUpdate("primary", "edited by A");
    assert((await a().authoredGet("primary")) === "edited by A", "the update did not land");
    const removed = await a().authoredRemove("primary");
    assert(removed === "edited by A", `removed ${short(removed)}`);
  });
  const pushed = await row(A, CALL, "authored vector: authoredVecPush", OK, () => a().authoredVecPush(`item-${tag}`), (i) => i);
  await row(B, CALL, "authored vector: A's item names A", OK, async () => {
    const owner = await b().authoredVecGetOwner(need(pushed, "a pushed index"));
    assert(owner === need(myA, "A's account"), `owned by ${short(owner)}`);
    assert((await b().authoredVecLen()) === 1, "the vector does not hold one item");
    return owner;
  }, (o) => o);
  await row(B, CALL, "authored vector: authoredVecUpdate (A's item)", appError("NotItemOwner"), () =>
    b().authoredVecUpdate(need(pushed, "a pushed index"), "by B"));
  await row(A, CALL, "shared: sharedSet (the owner, the one writer)", OK, () => a().sharedSet(`shared-${tag}`));
  await row(B, CALL, "shared: sharedSet by a non-writer is refused", appError("NotAWriter"), () => b().sharedSet("not a writer"));
  await row(B, CALL, "shared: the refused write did not land", OK, async () => {
    const v = await b().sharedGet();
    assert(v === `shared-${tag}`, `the shared value is ${short(v)}`);
    return v;
  }, (v) => v);
  await row(A, CALL, "shared: sharedAddWriter, then B writes", OK, async () => {
    await a().sharedAddWriter(need(myB, "B's account"));
    await b().sharedSet(`shared-by-B-${tag}`);
    assert((await a().sharedGet()) === `shared-by-B-${tag}`, "B's write as a writer did not land");
    assert((await a().sharedGetWriters()).length === 2, "the writer set is not two accounts");
  });
  await row(A, CALL, "callConfirmed (without the passkey)", "CONFIRM_REQUIRED", () => a().confirmedSet("confirmed", "1"));
  await row(A, CALL, "callConfirmed", OK, async () => {
    const r = await a().confirmedSet("confirmed", "1", A.passkey);
    assert((await a().get("confirmed")) === "1", "the confirmed write did not land");
    return r;
  }, (r) => r.index);
  await row(B, CALL, "callConfirmed (B's passkey, B's own call)", OK, () => b().confirmedSet("confirmed", "2", B.passkey), (r) => r.index);
  await row(A, CALL, "an app error (getResult, a missing key)", appError("NotFound"), () => a().getResult("missing"));
  await row(A, CALL, "a trap (getUnchecked, a missing key)", "TRAP", () => a().getUnchecked("missing"));
  await row(A, CALL, "malformed arguments", appError("BadArgs"), () =>
    A.client.apps.call({ app: appId(), method: "set", args: { key: "k" } }),
  );
  await row(A, CALL, "an unknown method (v0's snake_case name)", appError("UnknownMethod"), () =>
    A.client.apps.view({ app: appId(), method: "my_account", args: {} }),
  );
  await row(A, CALL, "a call made as a view", appError("NotAView"), () =>
    A.client.apps.view({ app: appId(), method: "set", args: { key: "k", value: "v" } }),
  );

  // ── access ────────────────────────────────────────────────────────────────
  const ACCESS = "Access";
  const anonymous = await env.client(0);
  await row(C, ACCESS, "view (an outsider)", "NOT_FOUND", () =>
    C.client.apps.view({ app: appId(), method: "get", args: { key: "conformance" } }),
  );
  await row(C, ACCESS, "call (an outsider)", "NOT_FOUND", () =>
    C.client.apps.call({ app: appId(), method: "set", args: { key: "x", value: "y" } }),
  );
  await row("anonymous", ACCESS, "view (no session)", "UNAUTHENTICATED", () =>
    anonymous.apps.view({ app: appId(), method: "get", args: { key: "conformance" } }),
  );
  await row(B, ACCESS, "the open team's app (reached by inheritance)", OK, () =>
    eventually(() => B.client.apps.view({ app: need(inOpen, "the open team's app"), method: "myAccount", args: {} }), () => true, "the open team's app"), (r) => r.result);
  await row(B, ACCESS, "the invite-only team's app (not a member yet)", "NOT_FOUND", () =>
    B.client.apps.view({ app: need(inClosed, "the invite-only team's app"), method: "myAccount", args: {} }));
  await row(C, ACCESS, "A's own app (an outsider)", "NOT_FOUND", () =>
    C.client.apps.view({ app: need(own, "A's own app"), method: "get", args: { key: "k" } }),
  );
  await row(A, ACCESS, "setAccess (accounts: the outsider)", OK, () =>
    A.client.apps.access({ app: need(own, "A's own app"), access: { kind: "accounts", accounts: [need(C.account, "the outsider's account")] } }));
  await row(C, ACCESS, "A's own app (an account it names)", OK, () =>
    eventually(() => C.client.apps.view({ app: need(own, "A's own app"), method: "myAccount", args: {} }), () => true, "access by account"), (r) => r.result);
  await row(A, ACCESS, "setAccess (public)", OK, () =>
    A.client.apps.access({ app: need(own, "A's own app"), access: { kind: "public" } }),
  );
  await row("anonymous", ACCESS, "a public method of a public app (no session)", OK, async () => {
    await contract(A.client, need(own, "A's own app")).set("open", "to anyone");
    const r = await eventually(
      () => anonymous.apps.view({ app: need(own, "A's own app"), method: "publicGet", args: { key: "open" } }),
      (r) => r.result === "to anyone",
      "the public read",
    );
    return r;
  }, (r) => r.result);
  await row("anonymous", ACCESS, "a method that is not public (no session)", "UNAUTHENTICATED", () =>
    anonymous.apps.view({ app: need(own, "A's own app"), method: "get", args: { key: "open" } }));
  const KEYS = "API keys";
  await row(A, KEYS, "createApiKey (without the step-up)", "CONFIRM_REQUIRED", () =>
    A.client.auth.apikeyCreate({ label: "conformance" }),
  );
  const apiKey = await row(A, KEYS, "createApiKey (read-only, one app)", OK, () =>
    A.client.auth.apikeyCreate({ label: `conformance-${tag}`, apps: [appId()], readOnly: true }, { confirm: passkeyConfirm(A.passkey) }), (k) => k.keyId);
  await row(A, KEYS, "listApiKeys", OK, async () => {
    const list = (await A.client.auth.apikeyList()).keys;
    assert(list.some((k) => k.keyId === apiKey?.keyId), "the new key is not listed");
    return list;
  }, (l) => `${l.length} keys`);
  const agent = await env.client(2);
  if (apiKey) agent.useApiKey(apiKey.key);
  await row("apiKey", KEYS, "view (a read-only key)", OK, async () => {
    const r = await agent.apps.view({ app: appId(), method: "myAccount", args: {} });
    assert(r.result === A.account, `the key acts as ${short(r.result)}`);
    return r;
  }, (r) => r.result);
  await row("apiKey", KEYS, "call (a read-only key)", "FORBIDDEN", () =>
    agent.apps.call({ app: appId(), method: "set", args: { key: "agent", value: "x" } }),
  );
  await row(A, KEYS, "revokeApiKey", OK, async () => {
    await A.client.auth.apikeyRevoke({ key: need(apiKey?.keyId, "an API key") }, { confirm: passkeyConfirm(A.passkey) });
    const list = (await A.client.auth.apikeyList()).keys;
    assert(!list.some((k) => k.keyId === apiKey?.keyId), "the key is still listed");
  });

  // ── members ───────────────────────────────────────────────────────────────
  const MEM = "Members";
  const bAcc = () => need(B.account, "B's account");
  await row(A, MEM, "setMember (promote to admin)", OK, async () => {
    await A.client.orgs.setMember(
      { org: orgId(), account: bAcc(), role: "admin" },
      { confirm: passkeyConfirm(A.passkey) },
    );
    await eventually(
      () => A.client.orgs.get({ org: orgId() }),
      (o) => lower((o.members as Record<string, unknown>)[bAcc()]) === "admin",
      "B as admin",
    );
  });
  await row(A, MEM, "setMember (back to member)", OK, () =>
    A.client.orgs.setMember({ org: orgId(), account: bAcc(), role: "member" }, { confirm: passkeyConfirm(A.passkey) }),
  );
  await row(A, MEM, "setTeamMember (the invite-only team)", OK, () =>
    A.client.orgs.teamSetMember({ org: orgId(), team: need(closed, "the invite-only team"), account: bAcc(), role: "member" }, { confirm: passkeyConfirm(A.passkey) }));
  await row(B, MEM, "the invite-only team's app (now a member)", OK, () =>
    eventually(() => B.client.apps.view({ app: need(inClosed, "the invite-only team's app"), method: "myAccount", args: {} }), () => true, "the team's app"), (r) => r.result);
  await row(A, MEM, "setTeamMember (lead, capabilities)", OK, () =>
    A.client.orgs.teamSetMember({ org: orgId(), team: need(closed, "the invite-only team"), account: bAcc(), lead: true, capabilities: ORG_CAPABILITIES.MANAGE_MEMBERS }, { confirm: passkeyConfirm(A.passkey) }));
  await row(A, MEM, "setCapabilities (a member, on a team)", OK, () =>
    A.client.orgs.capabilities({ org: orgId(), capabilities: orgCapabilities("CREATE_APP"), account: bAcc(), team: need(closed, "a team") }, { confirm: passkeyConfirm(A.passkey) }));
  await row(A, MEM, "setTeamMember (read-only)", OK, () =>
    A.client.orgs.teamSetMember({ org: orgId(), team: need(closed, "the invite-only team"), account: bAcc(), role: "readOnly", lead: false }, { confirm: passkeyConfirm(A.passkey) }));
  await row(B, MEM, "a read-only member's write is refused", "FORBIDDEN", () =>
    untilRefused(() => B.client.apps.call({ app: need(inClosed, "the team's app"), method: "set", args: { key: "ro", value: "x" } }), "B's write as read-only"));
  await row(A, MEM, "removeTeamMember", OK, () =>
    A.client.orgs.teamRemoveMember(
      { org: orgId(), team: need(closed, "the invite-only team"), account: bAcc() },
      { confirm: passkeyConfirm(A.passkey) },
    ),
  );
  await row(A, MEM, "setCapabilities (a member, org-wide)", OK, () =>
    A.client.orgs.capabilities({ org: orgId(), capabilities: orgCapabilities("JOIN_OPEN_TEAMS"), account: bAcc() }, { confirm: passkeyConfirm(A.passkey) }));

  // ── live: events and presence ─────────────────────────────────────────────
  const LIVE = "Events";
  await row(A, LIVE, "events (A hears its own first write)", OK, () =>
    heard(aHears, (e) => e.kind === "Inserted" && (e.data as { key?: string })?.key === "conformance", "A's Inserted"), (e) => e.kind);
  await row(A, LIVE, "events (A hears B's write)", OK, () =>
    heard(aHears, (e) => e.kind === "AuthoredInserted" && (e.data as { owner?: string })?.owner === B.account, "B's AuthoredInserted"), (e) => e.kind);
  await row(B, LIVE, "events (B hears A's write)", OK, () =>
    heard(bHears, (e) => e.kind === "UserSimpleSet" && (e.data as { account?: string })?.account === A.account, "A's UserSimpleSet"), (e) => e.kind);
  await row(B, LIVE, "events (replayed from index 0 on a new stream)", OK, async () => {
    const ac = new AbortController();
    const firstEvent = await B.client.events(appId(), 0, ac.signal).next();
    ac.abort();
    assert(firstEvent.value?.kind === "Inserted", `the first event replayed is ${short(firstEvent.value?.kind)}`);
    return firstEvent.value;
  }, (e) => e?.kind);
  aHears.stop();
  bHears.stop();
  const PRES = "Presence";
  await row(A, PRES, "publishPresence", OK, () =>
    A.client.apps.presencePublish({
      app: appId(),
      seq: 1,
      state: presenceState(enc.encode(`here-${tag}`)) as unknown as string,
    }),
  );
  const stateHex = Array.from(enc.encode(`here-${tag}`), (x) => x.toString(16).padStart(2, "0")).join("");
  await row(B, PRES, "presence (A is present)", OK, () =>
    eventually(() => B.client.apps.presenceGet({ app: appId() }).then((r) => r.present), (l) => l.some((p) => p.account === A.account && p.state === stateHex), "A's presence"),
  (l) => `${l.length} present`);
  await row(B, PRES, "presenceStream (a snapshot first)", OK, async () => {
    const ac = new AbortController();
    const firstEvent = await B.client.presenceStream(appId(), ac.signal).next();
    ac.abort();
    assert(firstEvent.value?.kind === "snapshot", `the stream opens with ${short(firstEvent.value?.kind)}`);
    return firstEvent.value;
  }, (e) => e?.kind);
  await row(A, PRES, "publishPresence (retract)", OK, async () => {
    await A.client.apps.presencePublish({ app: appId(), seq: 2, state: presenceState(null) as unknown as string });
    await eventually(
      () => B.client.apps.presenceGet({ app: appId() }).then((r) => r.present),
      (l) => !l.some((p) => p.account === A.account && p.state !== null),
      "A's presence retracted",
    );
  });

  // ── blobs ─────────────────────────────────────────────────────────────────
  // A component app's blobs are its own host records since core 1.0.0-rc.8
  // (R8, core #4815); rc.7 refused them by name (`409 NOT_SUPPORTED`). Set
  // BLOBS back to that code to check a node without them: the round trip below
  // runs only once an upload succeeds.
  const BLOB = "Blobs";
  const BLOBS = OK;
  const bytes = enc.encode(`blob-${tag}:${"conformance ".repeat(400)}`);
  const up = await row(A, BLOB, "uploadBlob (a component app)", BLOBS, async () => {
    const r = await A.client.apps.blobUpload({ app: appId(), body: bytes, contentType: "application/octet-stream" });
    assert(r.size === bytes.length, `stored ${r.size} bytes of ${bytes.length}`);
    return r;
  }, (r) => ({ blobId: r.blobId, size: r.size }));
  await row(A, BLOB, "listBlobs (a component app)", BLOBS, async () => {
    const r = (await A.client.apps.blobList({ app: appId() })).blobs;
    if (up) assert(r.some((x) => x.id === up.id), "the uploaded blob is not listed");
    return r;
  }, (r) => `${r.length} blobs`);
  if (up) {
    await row(A, BLOB, "blobInfo", OK, async () => {
      const r = await A.client.apps.blobInfo({ app: appId(), id: up.blobId });
      assert(r.size === bytes.length && r.id === up.id, `info: ${short(r)}`);
      return r;
    }, (r) => r);
    await row(A, BLOB, "downloadBlob (by its hex id)", OK, async () => {
      const got = await A.client.downloadBlob(appId(), up.id);
      assert(sameBytes(got, bytes), `read ${got.length} bytes that are not the ${bytes.length} uploaded`);
      return got.length;
    }, (n) => `${n} bytes`);
    await row(B, BLOB, "downloadBlob (second account)", OK, async () => {
      const got = await B.client.downloadBlob(appId(), up.blobId);
      assert(sameBytes(got, bytes), `read ${got.length} bytes that are not the ${bytes.length} uploaded`);
      return got.length;
    }, (n) => `${n} bytes`);
    await row(A, BLOB, "downloadBlob (through another app)", "NOT_FOUND", () => A.client.downloadBlob(need(own, "another app"), up.blobId));
    await row(A, BLOB, "deleteBlob", OK, () => A.client.apps.blobDelete({ app: appId(), id: up.blobId }));
    await row(A, BLOB, "blobInfo (deleted)", "NOT_FOUND", () => A.client.apps.blobInfo({ app: appId(), id: up.blobId }));
  }

  // ── upgrades, releases ────────────────────────────────────────────────────
  const UP = "Upgrades";
  await row(A, UP, "upgradeApp (without the step-up)", "CONFIRM_REQUIRED", () =>
    A.client.apps.upgrade({ app: need(fromPkg, "the package's app"), version: "0.0.1" }),
  );
  await row(A, UP, "upgradeApp (0.0.1)", OK, async () => {
    const pkgApp = contract(A.client, need(fromPkg, "the package's app"));
    await pkgApp.set("before", "the upgrade");
    const r = await A.client.apps.upgrade(
      { app: need(fromPkg, "the package's app"), version: "0.0.1" },
      { confirm: passkeyConfirm(A.passkey) },
    );
    assert(r.status === "ok", `the upgrade is ${short(r)}`);
    assert((await pkgApp.get("before")) === "the upgrade", "the state did not survive the upgrade");
    return r;
  }, (r) => r.status);
  await row(A, UP, "listApps (the upgraded app at 0.0.1)", OK, async () => {
    const l = await listAppInfos(A.client, { package: pkg });
    const x = l.find((y) => y.appId === fromPkg);
    assert(x?.version === "0.0.1", `listed at ${short(x?.version)}`);
    return x;
  }, (x) => x?.version);
  const run = await row(A, UP, "upgradeOrg (the package, 0.0.1)", OK, () =>
    A.client.orgs.upgrade({ org: orgId(), package: pkg, version: "0.0.1" }, { confirm: passkeyConfirm(A.passkey) }), (r) => ({ runId: r.runId, apps: r.apps.length }));
  await row(A, UP, "upgradeRun (until it finishes)", OK, async () => {
    const r = await eventually(
      () => A.client.orgs.upgradeStatus({ org: orgId(), run: need(run?.runId, "an upgrade run") }),
      (r) => r.finished,
      "the run finished",
      patience + 10_000,
    );
    assert(Object.keys(r.failed).length === 0, `failed: ${short(r.failed)}`);
    assert(r.done.includes(need(forRun, "the run's app")), `the run upgraded ${short(r.done)}`);
    return r;
  }, (r) => ({ done: r.done.length, failed: Object.keys(r.failed).length }));
  await row(A, UP, "retryUpgradeRun (nothing failed: nothing to run)", OK, async () => {
    const r = await A.client.orgs.upgradeRetry(
      { org: orgId(), run: need(run?.runId, "an upgrade run") },
      { confirm: passkeyConfirm(A.passkey) },
    );
    assert(r.apps.length === 0 && r.runId !== run?.runId, `the retry: ${short(r)}`);
    return r;
  }, (r) => r.apps.length);
  const REL = "Releases";
  await row(A, REL, "releaseRules", OK, () => A.client.public.releasesPublic(), (r) => Object.keys(r));
  await row(A, REL, "pendingApprovals (the org)", OK, () => A.client.pendingApprovals(orgId()), (r) => Object.keys(r));
  await row(A, REL, "appsReport (the org)", OK, () => A.client.orgs.apps({ org: orgId() }), (r) => Object.keys(r));
  await row(A, REL, "approveRelease (the org, then the account; withdrawn)", OK, async () => {
    await A.client.orgs.releaseApproval(
      { org: orgId(), version: "2.3.200", approved: true },
      { confirm: passkeyConfirm(A.passkey) },
    );
    await A.client.auth.accountReleaseApproval(
      { version: "2.3.200", approved: true },
      { confirm: passkeyConfirm(A.passkey) },
    );
    await A.client.auth.accountReleaseApproval(
      { version: "2.3.200", approved: false },
      { confirm: passkeyConfirm(A.passkey) },
    );
  });
  await row(A, REL, "approveOutbound (the package's declared prefixes, then none)", OK, async () => {
    await A.client.orgs.outboundApproval(
      { org: orgId(), package: pkg, prefixes: "manifest", replace: false },
      { confirm: passkeyConfirm(A.passkey) },
    );
    await A.client.orgs.outboundApproval(
      { org: orgId(), package: pkg, prefixes: [], replace: true },
      { confirm: passkeyConfirm(A.passkey) },
    );
  });
  await row(B, REL, "approveRelease (a member without APPROVE_RELEASES)", "FORBIDDEN", () =>
    B.client.orgs.releaseApproval({ org: orgId(), version: "2.3.200", approved: true }, { confirm: passkeyConfirm(B.passkey) }));

  // ── teardown ──────────────────────────────────────────────────────────────
  const END = "Teardown";
  await row(A, END, "transferApp (to B, an org member)", OK, async () => {
    await A.client.apps.transfer(
      { app: need(inOpen, "the open team's app"), to: bAcc() },
      { confirm: passkeyConfirm(A.passkey) },
    );
    const x = await B.client.apps.get({ app: need(inOpen, "the open team's app") });
    assert(x.owner === B.account, `owned by ${short(x.owner)}`);
    return x;
  }, (x) => short(x.owner, 12));
  await row(B, END, "removeMember (B leaves the org)", OK, () =>
    B.client.orgs.removeMember({ org: orgId(), account: bAcc() }, { confirm: passkeyConfirm(B.passkey) }),
  );
  await row(B, END, "the org's app after leaving", "NOT_FOUND", () =>
    untilRefused(() => B.client.apps.view({ app: appId(), method: "get", args: { key: "conformance" } }), "B's read after leaving"));
  for (const [what, id] of [["the main app", app], ["the package's app", fromPkg], ["the run's app", forRun], ["the invite-only team's app", inClosed], ["A's own app", own]] as const) {
    await row(A, END, `deleteApp (${what})`, OK, () => A.client.apps.delete({ app: need(id, what) }));
  }
  await row(A, END, "getApp (deleted)", "NOT_FOUND", () => A.client.apps.get({ app: appId() }));
  await row(A, END, "deleteTeam (moves with its sub-team)", OK, () =>
    A.client.orgs.teamDelete({ org: orgId(), team: need(closed, "a team") }),
  );
  await row(A, END, "getTeam (deleted)", "NOT_FOUND", () =>
    A.client.orgs.teamGet({ org: orgId(), team: need(moved, "the moved team") }),
  );
  await row(A, END, "deleteOrg (without the step-up)", "CONFIRM_REQUIRED", () => A.client.orgs.delete({ org: orgId() }));
  await row(A, END, "deleteOrg", OK, () =>
    A.client.orgs.delete({ org: orgId() }, { confirm: passkeyConfirm(A.passkey) }),
  );
  await row(A, END, "getOrg (deleted)", "NOT_FOUND", () => A.client.orgs.get({ org: orgId() }));
  await row(A, END, "uninstallPackage", OK, async () => {
    await A.client.packages.uninstall({ package: pkg });
    const list = (await A.client.packages.list()).packages;
    assert(!list.some((p) => p.package === pkg), `${pkg} is still installed`);
  });
  await row(B, END, "signOut", OK, () => B.client.signOut());
  await row(B, END, "me (signed out)", "UNAUTHENTICATED", () => B.client.auth.me());
  await row(A, END, "signOutEverywhere", OK, () => A.client.signOutEverywhere());
  await row(A, END, "me (another device, after signOutEverywhere)", "UNAUTHENTICATED", () => elsewhere.auth.me());
  return rows;
}
