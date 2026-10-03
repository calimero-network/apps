/**
 * The matrix: every admin and RPC method an app makes, grouped into phases the
 * runner interleaves across two sessions.
 *
 * The PRIMARY session is the run's subject — a node in the node run, account A
 * in the account run — and does the same calls in both. The SECOND session is
 * always account B: it joins what the primary made, reads what the primary
 * wrote (the author checks), writes something the primary reads back, and
 * leaves. A row's expectation is per mode of the session that makes the call;
 * mero-react's `NODE_ONLY` calls are expected to be refused by name for an
 * account, and nothing else may fail.
 *
 *   p:start     identity, (account: first join), namespace, groups, contexts, RPC writes
 *   [runner]    node run only: the rig seats the relay in the new namespace as a
 *               RelayTee, which is what lets an account be admitted to it
 *   p:invite    createNamespaceInvitation
 *   s:join      B joins, joins contexts and an open subgroup, reads the primary's writes, writes
 *   p:members   the primary sees B and B's write, manages B in a restricted group
 *   [runner]    node run only: the rig installs the 0.0.1 bundle on the node
 *   p:upgrade   upgradeGroup and the status reads (refused by name on an account)
 *   s:upgraded  node run only: B reads through the upgraded namespace
 *   s:leave     B leaves a context (refused on an account), a group it was added to
 *               (and is refused a subgroup it only inherits), the namespace
 *   p:teardown  detach, delete context, delete groups, delete namespace
 *
 * Woven through those, the areas that span both sessions:
 *
 *   Blobs       p:start uploads, reads the info and the bytes back; s:join
 *               downloads the primary's blob through the context; p:members deletes it
 *   Events      p:invite and s:join subscribe to the main context; each session
 *               then writes, and the other's subscription must hear it
 *   Presence    the same shape: each publishes, the other must see it
 *   Aliases, TEE policy, devices, node-only
 *               p:start and p:members: ok on a node, refused by name on an account
 *   Upgrades    p:upgrade (after the rig installs 0.0.1 on the node) upgrades the
 *               namespace and reads its status; s:upgraded reads through it
 */
import type { AdminApiClient } from '@calimero-network/mero-react';
import { ADMIN_ONLY, adminOnly, assert, Blocked, check, eventually, need, NODE_ONLY, NOT_DIRECT_MEMBER, OK, short, type RowContext } from './check';
import { EventLog, PresenceLog, type Streams } from './listen';
import type { Mode } from './types';

/** What a phase reaches the session through; always the CURRENT admin and client. */
export interface Session extends RowContext {
  admin(): AdminApiClient;
  /** `rpc.execute` on the current client. */
  execute(contextId: string, method: string, args?: Record<string, unknown>): Promise<unknown>;
  /** The current client's event stream and presence, as `useSubscription` and `useEphemeral` read them. */
  streams(): Streams;
  /** Wait until the session is connected again, after a call that reconnects it (an account's join). */
  settle(previousAdmin: AdminApiClient | null): Promise<void>;
}

/** State a primary run carries between its phases. */
interface Primary {
  account?: string;
  myAccount?: string;
  deviceId?: string;
  namespaceId?: string;
  namespaceIsRig?: boolean;
  groups: { restricted?: string; open?: string; inherit?: string; reparent?: string; leave?: string };
  contexts: { main?: string; inOpen?: string; detach?: string };
  values: { public?: string; user?: string; authoredKey?: string; presence?: string };
  blob?: { id?: string; text: string };
}

const primaries = new Map<Session, Primary>();
function primary(s: Session): Primary {
  let p = primaries.get(s);
  if (!p) {
    p = { groups: {}, contexts: {}, values: {} };
    primaries.set(s, p);
  }
  return p;
}

/** The subscriptions a session holds open between phases. */
interface Listening {
  events?: EventLog;
  presence?: PresenceLog;
}
const listening = new Map<Session, Listening>();
function listeners(s: Session): Listening {
  let l = listening.get(s);
  if (!l) {
    l = {};
    listening.set(s, l);
  }
  return l;
}

const encoder = new TextEncoder();
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
/** The version the rig's second bundle carries (`--app-version`, rig/up.sh). */
export const UPGRADE_VERSION = '0.0.1';

const lower = (x: unknown) => String(x ?? '').toLowerCase();
const tag = () => Math.random().toString(36).slice(2, 8);
const memberIds = (r: { members?: Array<{ identity: string }> } | Array<{ identity: string }>) =>
  (Array.isArray(r) ? r : (r.members ?? [])).map((m) => lower(m.identity));
const contextIds = (r: { contexts?: Array<{ id: string }> }) => (r.contexts ?? []).map((c) => c.id);
const namespaceIds = (r: Array<{ namespaceId: string }>) => r.map((n) => n.namespaceId);
const subgroupIds = (r: Array<{ groupId: string }>) => r.map((g) => g.groupId);

export interface StartInput {
  readonly applicationId: string;
  readonly rigNamespaceId: string;
  /** The rig's invitation to its namespace: how an account gets its first relay. */
  readonly rigInvitation: unknown;
}

export interface StartOutput {
  readonly namespaceId: string | null;
  readonly namespaceIsRig: boolean;
  readonly primaryAccount: string | null;
  readonly primaryMyAccount: string | null;
  readonly contexts: Primary['contexts'];
  readonly groups: Primary['groups'];
  readonly values: Primary['values'];
  /** The primary's blob in the main context, and the text it holds. */
  readonly blob: { id: string | null; text: string } | null;
}

async function start(s: Session, input: StartInput): Promise<StartOutput> {
  const p = primary(s);
  const A = 'Identity';
  const N = 'Namespaces';
  const G = 'Groups';
  const C = 'Contexts';
  const R = 'RPC writes';

  const identity = await check(s, A, 'getNodeIdentity', OK, () => s.admin().getNodeIdentity(), (v) => v);
  p.account = identity?.accountId ? lower(identity.accountId) : undefined;
  p.deviceId = identity?.deviceId ?? undefined;

  // The account's first relay comes from an invitation: before it, the account
  // is a member of nothing. A target that names its relay and the relay's
  // executor account instead (the cloud shows both) skips the join, and the
  // account founds its namespace on that relay directly.
  if (s.mode === 'account' && input.rigInvitation) {
    const before = s.admin();
    await check(s, N, 'joinNamespace (rig invitation, first relay)', OK, async () => {
      const r = await before.joinNamespace(input.rigNamespaceId, { invitation: input.rigInvitation as never });
      await s.settle(before);
      return r;
    }, (v) => v);
  }

  // A founding can succeed and the application step after it fail ("founded
  // <id> but could not give it its application"): the namespace exists, so the
  // rows that do not need the application still run on it.
  let foundedWithoutApp: string | undefined;
  const created = await check(s, N, 'createNamespace', OK, async () => {
    try {
      return await s.admin().createNamespace({ applicationId: input.applicationId, name: `conformance-${tag()}` });
    } catch (e) {
      foundedWithoutApp = /founded ([0-9a-f]{64})/.exec(String((e as Error)?.message))?.[1];
      throw e;
    }
  }, (v) => {
    // An account's founding also asks the cloud to host the namespace (HA),
    // best-effort; its outcome rides along as extra fields. Spelled out so a
    // long haError is not cut off with the id.
    const ha = v as { namespaceId: string; haEnabled?: boolean; haError?: string };
    if (ha.haEnabled === undefined) return v;
    return `${short(ha.namespaceId, 12)} haEnabled=${ha.haEnabled}${ha.haError ? ` haError: ${ha.haError}` : ''}`;
  });
  p.namespaceId = created?.namespaceId ?? foundedWithoutApp;
  p.namespaceIsRig = false;
  if (!p.namespaceId && input.rigNamespaceId) {
    // The rest still says something on the rig's own namespace; teardown leaves it alone.
    p.namespaceId = input.rigNamespaceId;
    p.namespaceIsRig = true;
  }
  if (!p.namespaceId) {
    // No namespace at all, and none to fall back on: every later row would call
    // a route with an empty id and report the refusal as the finding. Stop here;
    // the runner skips the phases that need one.
    return { namespaceId: null, namespaceIsRig: false, primaryAccount: p.account ?? null, primaryMyAccount: p.myAccount ?? null, contexts: p.contexts, groups: p.groups, values: p.values, blob: null };
  }
  const ns = p.namespaceId;

  await check(s, N, 'listNamespaces', OK, () =>
    eventually(() => s.admin().listNamespaces(), (r) => namespaceIds(r).includes(ns), `listNamespaces lists ${ns.slice(0, 8)}`),
    (r) => `${r.length} namespaces`);
  await check(s, N, 'listNamespacesForApplication', OK, () =>
    eventually(() => s.admin().listNamespacesForApplication(input.applicationId), (r) => namespaceIds(r).includes(ns), 'the namespace is listed for its application'),
    (r) => `${r.length} namespaces`);
  await check(s, N, 'getGroupInfo', OK, () => s.admin().getGroupInfo(ns), (v) => v);

  const group = (name: string, visibility: 'open' | 'restricted') =>
    check(s, G, `createGroupInNamespace (${visibility}, ${name})`, OK, async () =>
      (await s.admin().createGroupInNamespace(ns, { groupName: `${name}-${tag()}`, visibility })).groupId, (v) => v);
  p.groups.restricted = await group('restricted', 'restricted');
  p.groups.open = await group('open', 'open');
  p.groups.inherit = await group('inherit', 'open');
  p.groups.reparent = await group('reparent', 'restricted');
  p.groups.leave = await group('leave', 'restricted');

  const made = Object.values(p.groups).filter(Boolean) as string[];
  await check(s, G, 'listSubgroups', OK, () =>
    eventually(() => s.admin().listSubgroups(ns), (r) => made.every((g) => subgroupIds(r).includes(g)), 'every subgroup made is listed'),
    (r) => `${r.length} subgroups`);
  await check(s, G, 'listGroupMembers', OK, async () => {
    const r = await s.admin().listGroupMembers(ns);
    assert(memberIds(r).includes(need(p.account, 'the session account')), `the session's own account ${p.account} is not a member of its namespace`);
    return r;
  }, (r) => `${memberIds(r).length} members`);
  await check(s, G, 'getMemberCapabilities (self)', OK, () => s.admin().getMemberCapabilities(ns, need(p.account, 'the session account')), (v) => v);
  await check(s, G, 'setDefaultCapabilities', OK, () =>
    s.admin().setDefaultCapabilities(need(p.groups.restricted, 'a restricted group'), { defaultCapabilities: 231 }));
  await check(s, G, 'setSubgroupVisibility', OK, () =>
    s.admin().setSubgroupVisibility(need(p.groups.reparent, 'a group to change'), { subgroupVisibility: 'open' }));
  await check(s, G, 'setGroupMetadata', OK, () =>
    s.admin().setGroupMetadata(need(p.groups.restricted, 'a restricted group'), { name: `renamed-${tag()}` }));
  await check(s, G, 'setMemberMetadata (self)', OK, () =>
    s.admin().setMemberMetadata(ns, need(p.account, 'the session account'), { name: `primary-${s.mode}` }));
  await check(s, G, 'reparentGroup', OK, () =>
    s.admin().reparentGroup(need(p.groups.reparent, 'a group to move'), { newParentId: need(p.groups.restricted, 'a new parent') }), (v) => v);

  const context = (name: string, groupId: string | undefined) =>
    check(s, C, `createContext (${name})`, OK, async () =>
      (await s.admin().createContext({ applicationId: input.applicationId, groupId: need(groupId, `a group for ${name}`), name: `${name}-${tag()}` })).contextId, (v) => v);
  p.contexts.main = await context('in the namespace', ns);
  p.contexts.inOpen = await context('in an open subgroup', p.groups.open);
  p.contexts.detach = await context('to detach', ns);
  const ctx = p.contexts.main;

  await check(s, C, 'getContexts', OK, () =>
    eventually(() => s.admin().getContexts(), (r) => contextIds(r).includes(need(ctx, 'a context')), 'the new context is listed'),
    (r) => `${contextIds(r).length} contexts`);
  await check(s, C, 'getContext', OK, () => s.admin().getContext(need(ctx, 'a context')), (v) => ({ id: v.id, applicationId: v.applicationId }));
  await check(s, C, 'getContextGroup', OK, async () => {
    const g = await s.admin().getContextGroup(need(ctx, 'a context'));
    const id = typeof g === 'string' ? g : (g as { groupId?: string } | null)?.groupId ?? JSON.stringify(g);
    assert(lower(id).includes(lower(ns)), `the context's group is ${id}, not the namespace ${ns}`);
    return g;
  }, (v) => v);
  await check(s, A, 'getContextIdentitiesOwned', OK, async () => {
    const r = await s.admin().getContextIdentitiesOwned(need(ctx, 'a context'));
    const ids = (r as { identities?: string[] }).identities ?? [];
    assert(ids.length > 0, 'owns no identity in a context it created');
    return r;
  }, (v) => v);
  await check(s, C, 'setContextMetadata', OK, () =>
    s.admin().setContextMetadata(ns, need(ctx, 'a context'), { name: `renamed-${tag()}` }));
  await check(s, C, 'syncContext', OK, () => s.admin().syncContext(need(ctx, 'a context')));

  // RPC writes: one per storage kind, read back by the same session.
  const my = await check(s, R, 'my_account', OK, async () => String(await s.execute(need(ctx, 'a context'), 'my_account')), (v) => v);
  p.myAccount = my;
  await check(s, A, 'my_account is the session account', OK, async () => {
    assert(lower(need(my, 'my_account')) === need(p.account, 'the session account'), `the contract runs as ${my}, the session is ${p.account}`);
  });

  p.values.public = `pub-${s.mode}-${tag()}`;
  await check(s, R, 'public: set', OK, () => s.execute(need(ctx, 'a context'), 'set', { key: 'conformance', value: p.values.public }));
  await check(s, R, 'public: get', OK, async () => {
    const v = await s.execute(need(ctx, 'a context'), 'get', { key: 'conformance' });
    assert(v === p.values.public, `read ${String(v)}, wrote ${p.values.public}`);
    return v;
  }, (v) => v);

  p.values.user = `user-${s.mode}-${tag()}`;
  await check(s, R, 'user: set_user_simple', OK, () => s.execute(need(ctx, 'a context'), 'set_user_simple', { value: p.values.user }));
  await check(s, R, 'user: get_user_simple', OK, async () => {
    const v = await s.execute(need(ctx, 'a context'), 'get_user_simple');
    assert(v === p.values.user, `read ${String(v)}, wrote ${p.values.user}`);
    return v;
  }, (v) => v);

  const frozenValue = `frozen-${s.mode}-${tag()}`;
  const hash = await check(s, R, 'frozen: add_frozen', OK, async () => String(await s.execute(need(ctx, 'a context'), 'add_frozen', { value: frozenValue })), (v) => v);
  await check(s, R, 'frozen: get_frozen', OK, async () => {
    const v = await s.execute(need(ctx, 'a context'), 'get_frozen', { hash_hex: need(hash, 'a frozen hash') });
    assert(v === frozenValue, `read ${String(v)}, wrote ${frozenValue}`);
    return v;
  }, (v) => v);

  p.values.authoredKey = `primary-${s.mode}`;
  await check(s, R, 'authored map: authored_insert', OK, () =>
    s.execute(need(ctx, 'a context'), 'authored_insert', { key: p.values.authoredKey, value: 'by the primary' }));
  await check(s, R, 'authored map: owner is the caller', OK, async () => {
    const owner = await s.execute(need(ctx, 'a context'), 'authored_get_owner', { key: p.values.authoredKey });
    assert(lower(owner) === lower(need(my, 'my_account')), `owned by ${String(owner)}, written by ${my}`);
    return owner;
  }, (v) => v);

  await check(s, R, 'authored vector: authored_vec_push', OK, () => s.execute(need(ctx, 'a context'), 'authored_vec_push', { value: 'by the primary' }), (v) => v);
  await check(s, R, 'authored vector: owner is the caller', OK, async () => {
    const owner = await s.execute(need(ctx, 'a context'), 'authored_vec_get_owner', { index: 0 });
    assert(lower(owner) === lower(need(my, 'my_account')), `owned by ${String(owner)}, written by ${my}`);
    return owner;
  }, (v) => v);

  // The context's creator is its shared value's only writer (init's caller).
  const shared = `shared-${s.mode}-${tag()}`;
  await check(s, R, 'shared: shared_set (as the init caller)', OK, () => s.execute(need(ctx, 'a context'), 'shared_set', { value: shared }));
  await check(s, R, 'shared: shared_get', OK, async () => {
    const v = await s.execute(need(ctx, 'a context'), 'shared_get');
    assert(v === shared, `read ${String(v)}, wrote ${shared}`);
    return v;
  }, (v) => v);

  await blobs(s, p);
  await nodeOnlyCalls(s, p, input);

  return {
    namespaceId: p.namespaceId ?? null,
    namespaceIsRig: Boolean(p.namespaceIsRig),
    primaryAccount: p.account ?? null,
    primaryMyAccount: p.myAccount ?? null,
    contexts: p.contexts,
    groups: p.groups,
    values: p.values,
    blob: p.blob ? { id: p.blob.id ?? null, text: p.blob.text } : null,
  };
}

/**
 * Upload, then read back. Announced to the main context: core holds a blob for
 * the context it was uploaded with, and that is also what lets another member
 * find it there (s:join downloads it).
 */
async function blobs(s: Session, p: Primary): Promise<void> {
  const B = 'Blobs';
  const ctx = p.contexts.main;
  // Big enough to be more than one read of the stream, small enough to be quick.
  const text = `blob-${s.mode}-${tag()}:${'conformance '.repeat(400)}`;
  const bytes = encoder.encode(text);
  p.blob = { text };
  const up = await check(s, B, 'uploadBlob (announced to the main context)', OK, async () => {
    const r = await s.admin().uploadBlob({ data: bytes, contextId: need(ctx, 'a context') });
    assert(r.size === bytes.length, `stored ${r.size} bytes of ${bytes.length}`);
    return r;
  }, (v) => v);
  p.blob.id = up?.blobId;
  await check(s, B, 'getBlobInfo', OK, async () => {
    const info = await s.admin().getBlobInfo(need(p.blob?.id, 'an uploaded blob'), { contextId: need(ctx, 'a context') });
    assert(info.size === bytes.length, `info says ${info.size} bytes, uploaded ${bytes.length}`);
    return info;
  }, (v) => v);
  await check(s, B, 'getBlob (the bytes match)', OK, async () => {
    const got = new Uint8Array(await s.admin().getBlob(need(p.blob?.id, 'an uploaded blob'), { contextId: need(ctx, 'a context') }));
    assert(sameBytes(got, bytes), `read ${got.length} bytes that are not the ${bytes.length} uploaded`);
    return got.length;
  }, (n) => `${n} bytes`);
}

/**
 * The calls mero-react lists as `NODE_ONLY` (account-admin.ts) that a node can
 * make without breaking the rig, and the reads beside them that are not on that
 * list — which an account must therefore answer as a node does. Each node call
 * undoes itself: an alias is created, read and deleted.
 */
async function nodeOnlyCalls(s: Session, p: Primary, input: StartInput): Promise<void> {
  const ctx = p.contexts.main;
  const AL = 'Aliases';
  // Created by a node and refused to an account, so on an account the reads
  // below look up a name nobody made: a node answers that with no value.
  const aliasOf = (kind: string) => `conf-${kind}-${s.mode}-${tag()}`;
  const aliases = [
    {
      kind: 'context',
      target: ctx,
      create: (alias: string, id: string) => s.admin().createContextAlias({ alias, contextId: id }),
      lookup: (alias: string) => s.admin().lookupContextAlias(alias),
      list: () => s.admin().listContextAliases(),
      remove: (alias: string) => s.admin().deleteContextAlias(alias),
    },
    {
      kind: 'application',
      target: input.applicationId,
      create: (alias: string, id: string) => s.admin().createApplicationAlias({ alias, applicationId: id }),
      lookup: (alias: string) => s.admin().lookupApplicationAlias(alias),
      list: () => s.admin().listApplicationAliases(),
      remove: (alias: string) => s.admin().deleteApplicationAlias(alias),
    },
    {
      // An account's identity carries no device id; its create is refused
      // before the id is read, so the zero id never reaches a node.
      kind: 'device',
      target: s.mode === 'account' ? '0'.repeat(64) : p.deviceId,
      create: (alias: string, id: string) => s.admin().createDeviceAlias({ alias, deviceId: id }),
      lookup: (alias: string) => s.admin().lookupDeviceAlias(alias),
      list: () => s.admin().listDeviceAliases(),
      remove: (alias: string) => s.admin().deleteDeviceAlias(alias),
    },
  ];
  for (const a of aliases) {
    const alias = aliasOf(a.kind);
    const made = await check(s, AL, `create${cap(a.kind)}Alias`, NODE_ONLY, async () => {
      await a.create(alias, need(a.target, `a ${a.kind} id`));
      return true;
    });
    // Reading an alias is as much a node's own as writing one: refused by name
    // for an account (mero-react 9.6.3).
    await check(s, AL, `lookup${cap(a.kind)}Alias`, NODE_ONLY, async () => {
      const r = await a.lookup(alias);
      if (made) assert(lower(r?.value) === lower(a.target), `${alias} names ${String(r?.value)}, not ${a.target}`);
      else assert(!r?.value, `${alias} was never created, yet names ${String(r?.value)}`);
      return r;
    }, (v) => v);
    await check(s, AL, `list${cap(a.kind)}Aliases`, NODE_ONLY, async () => {
      const r = await a.list();
      if (made) assert(lower(r[alias]) === lower(a.target), `the listing has ${alias} as ${String(r[alias])}`);
      else assert(!(alias in r), `${alias} was never created, yet is listed`);
      return r;
    }, (v) => `${Object.keys(v).length} aliases`);
    await check(s, AL, `delete${cap(a.kind)}Alias`, NODE_ONLY, () => a.remove(alias));
  }

  const D = 'Devices';
  // Devices are the wallet's: core maps the route to `admin` alone, so an app's
  // token is refused on a node, and mero-react refuses an account by name.
  await check(s, D, 'listAccountDevices', ADMIN_ONLY, async () => {
    const r = await adminOnly(() => s.admin().listAccountDevices());
    assert(r.some((d) => d.isSelf), 'lists no device as this node\'s own');
    return r;
  }, (v) => `${v.length} devices`);
  // The node form is not staged: the owner account's one device is the node's
  // own, and revoking it would cut the rig's owner off. An account is refused
  // before anything is sent, so the id is never used.
  if (s.mode === 'account') {
    await check(s, D, 'revokeAccountDevice', NODE_ONLY, () =>
      s.admin().revokeAccountDevice(need(p.namespaceId, 'a namespace'), { deviceId: '0'.repeat(64) }));
  }

  const X = 'Node-only';
  await check(s, X, 'generateContextIdentity', NODE_ONLY, async () => {
    const r = await s.admin().generateContextIdentity();
    assert(/^[0-9a-zA-Z]{32,}$/.test(r.publicKey ?? ''), `no public key in ${short(r)}`);
    return r;
  }, (v) => v);
  await check(s, X, 'createGroupInvitation (a restricted subgroup)', NODE_ONLY, () =>
    s.admin().createGroupInvitation(need(p.groups.restricted, 'a restricted group')), (v) => Object.keys(v));
}

const cap = (x: string) => x[0]!.toUpperCase() + x.slice(1);

async function invite(s: Session): Promise<{ invitation: unknown; presence: string | null }> {
  const p = primary(s);
  const ns = p.namespaceId;
  const r = await check(s, 'Namespaces', 'createNamespaceInvitation', OK, async () => {
    const id = need(ns, 'a namespace');
    if (s.mode === 'account') return s.admin().createNamespaceInvitation(id);
    // A node's invitation names the admins unless told otherwise, and an
    // account with no node can only be admitted by a relay — so a node inviting
    // an account names its relays, as mero-react's account admin does for an
    // account. mero-js's request type has no `admitters` yet; the route does.
    const relays = ((await s.admin().listGroupMembers(id)).members ?? [])
      .filter((m) => m.role === 'RelayTee')
      .map((m) => lower(m.identity));
    if (relays.length === 0) throw new Blocked('the namespace has no RelayTee member to name as admitter');
    return s.admin().createNamespaceInvitation(id, { admitters: relays } as never);
  }, (v) => ({ admitters: (v as { invitation?: { invitation?: { admitters?: unknown } } }).invitation?.invitation?.admitters }));
  await listen(s, need(p.contexts.main, 'a context'), p);
  return { invitation: (r as { invitation?: unknown } | undefined)?.invitation ?? null, presence: p.values.presence ?? null };
}

/**
 * Subscribe to the main context's events and presence, and publish this
 * session's presence there. Before the other session acts, so what it does is
 * heard live; presence is also replayed to a later subscriber, so the order
 * does not decide whether the other session sees it.
 */
async function listen(s: Session, ctx: string, p: { values: { presence?: string } }): Promise<void> {
  const l = listeners(s);
  // Presence first. Both ride the client's one event stream, and the node
  // replays a context's presence once, to the subscription that first names the
  // context: a presence listener attached after the events subscription would
  // never be seeded (`SseClient.subscribe` skips a context it already holds),
  // so a slot published before this session arrived would never be seen.
  await check(s, 'Presence', `subscribe (${s.session})`, OK, async () => {
    l.presence = PresenceLog.open(s.streams().presence, ctx);
  });
  await check(s, 'Events', `subscribe (${s.session}, the main context)`, OK, async () => {
    l.events = await EventLog.open(s.streams().events, ctx);
  });
  p.values.presence = `${s.session}-${s.run}-${tag()}`;
  await check(s, 'Presence', `publish (${s.session})`, OK, () => s.streams().presence.set(ctx, { who: p.values.presence }));
}

export interface JoinInput {
  readonly start: StartOutput;
  readonly invitation: unknown;
  /** The presence the primary published (its `p:invite` output). */
  readonly primaryPresence?: string | null;
}

export interface JoinOutput {
  readonly account: string | null;
  readonly myAccount: string | null;
  /** What the second session wrote for the primary's event subscription, and published as presence. */
  readonly eventMarker: string | null;
  readonly presence: string | null;
}

async function secondJoin(s: Session, input: JoinInput): Promise<JoinOutput> {
  const { start: st } = input;
  const ns = st.namespaceId;
  const ctx = st.contexts.main;
  const id = await check(s, 'Identity', 'getNodeIdentity (second session)', OK, () => s.admin().getNodeIdentity(), (v) => v);
  const account = id?.accountId ? lower(id.accountId) : null;

  const before = s.admin();
  await check(s, 'Namespaces', 'joinNamespace (second session, the primary\'s invitation)', OK, async () => {
    const r = await before.joinNamespace(need(ns, 'a namespace'), { invitation: need(input.invitation, 'an invitation') as never });
    await s.settle(before);
    return r;
  }, (v) => v);
  await check(s, 'Namespaces', 'listNamespaces (second session)', OK, () =>
    eventually(() => s.admin().listNamespaces(), (r) => namespaceIds(r).includes(need(ns, 'a namespace')), 'the joined namespace is listed'),
    (r) => `${r.length} namespaces`);
  await check(s, 'Contexts', 'joinContext (in the namespace)', OK, () => s.admin().joinContext(need(ctx, 'a context')), (v) => v);
  await check(s, 'Identity', 'getContextIdentitiesOwned (second session)', OK, async () => {
    const r = await eventually(() => s.admin().getContextIdentitiesOwned(need(ctx, 'a context')),
      (v) => ((v as { identities?: string[] }).identities ?? []).length > 0, 'owns an identity in the joined context');
    return r;
  }, (v) => v);

  const R = 'RPC writes';
  await check(s, R, 'public: get (written by the primary)', OK, () =>
    eventually(() => s.execute(need(ctx, 'a context'), 'get', { key: 'conformance' }), (v) => v === st.values.public, 'the primary\'s public write'), (v) => v);
  await check(s, R, 'user: get_user_simple_for (the primary\'s slot)', OK, () =>
    eventually(() => s.execute(need(ctx, 'a context'), 'get_user_simple_for', { user_key: need(st.primaryMyAccount, 'the primary\'s account') }),
      (v) => v === st.values.user, 'the primary\'s user value'), (v) => v);
  await check(s, R, 'authored map: the primary\'s entry names the primary', OK, () =>
    eventually(() => s.execute(need(ctx, 'a context'), 'authored_get_owner', { key: need(st.values.authoredKey, 'an authored key') }),
      (v) => lower(v) === lower(st.primaryMyAccount), 'the primary as author'), (v) => v);
  const my = await check(s, R, 'my_account (second session)', OK, async () => String(await s.execute(need(ctx, 'a context'), 'my_account')), (v) => v);
  await check(s, R, 'authored map: authored_insert (second session)', OK, () =>
    s.execute(need(ctx, 'a context'), 'authored_insert', { key: 'second', value: 'by the second session' }));
  // The second session is not in the shared value's writer set (only the
  // context's creator is), so the contract refuses the write. The caller must be
  // told: a refusal reported as success is a write the app believes happened.
  await check(s, R, 'shared: shared_set by a non-writer is refused', OK, async () => {
    const attempt = `not-a-writer-${s.run}`;
    let returned: unknown;
    try {
      returned = await s.execute(need(ctx, 'a context'), 'shared_set', { value: attempt });
    } catch (e) {
      return `refused: ${(e as Error).message}`.slice(0, 120);
    }
    const now = await s.execute(need(ctx, 'a context'), 'shared_get');
    throw new Error(
      now === attempt
        ? 'a session outside the writer set wrote the shared value'
        : `the call resolved (returned ${JSON.stringify(returned)}) though the write did not land (the value is still ${JSON.stringify(now)}): a refused write was reported as success`,
    );
  }, (v) => v);

  await check(s, 'Contexts', 'joinContext (in an open subgroup)', OK, () => s.admin().joinContext(need(st.contexts.inOpen, 'a context in an open subgroup')), (v) => v);
  await check(s, 'Groups', 'joinSubgroupInheritance (open subgroup)', OK, () => s.admin().joinSubgroupInheritance(need(st.groups.inherit, 'an open subgroup')), (v) => v);

  // Another member's blob, found through the context it was announced to.
  await check(s, 'Blobs', 'getBlob (the primary\'s, through the shared context)', OK, async () => {
    const want = encoder.encode(need(st.blob?.text, 'the primary\'s blob'));
    const got = new Uint8Array(await eventually(
      () => s.admin().getBlob(need(st.blob?.id, 'the primary\'s blob id'), { contextId: need(ctx, 'a context') }),
      () => true, 'the primary\'s blob'));
    assert(sameBytes(got, want), `read ${got.length} bytes that are not the primary's ${want.length}`);
    return got.length;
  }, (n) => `${n} bytes`);

  // Events and presence: listen, see the primary's presence, then write and
  // publish for the primary to hear (p:members).
  const mine = { values: {} as { presence?: string } };
  await listen(s, need(ctx, 'a context'), mine);
  await check(s, 'Presence', 'the primary\'s presence is seen (second session)', OK, () =>
    need(listeners(s).presence, 'a presence subscription').waitFor(need(input.primaryPresence, 'the primary\'s presence'), 'the primary\'s presence'),
  (e) => ({ author: e.author, account: e.account, state: e.state }));
  const eventMarker = `event-second-${s.run}-${tag()}`;
  await check(s, 'Events', 'set (second session, for the primary\'s subscription)', OK, () =>
    s.execute(need(ctx, 'a context'), 'set', { key: 'event-second', value: eventMarker }));
  return { account, myAccount: my ?? null, eventMarker, presence: mine.values.presence ?? null };
}

export interface MembersInput {
  readonly secondAccount: string | null;
  readonly secondMyAccount: string | null;
  readonly secondEventMarker: string | null;
  readonly secondPresence: string | null;
}

async function members(s: Session, input: MembersInput): Promise<{ eventMarker: string }> {
  const p = primary(s);
  const ns = p.namespaceId;
  const b = input.secondAccount;
  const G = 'Groups';
  await check(s, G, 'listGroupMembers lists the second session', OK, () =>
    eventually(() => s.admin().listGroupMembers(need(ns, 'a namespace')), (r) => memberIds(r).includes(lower(need(b, 'the second account'))), 'the second account is a member'),
    (r) => `${memberIds(r).length} members`);
  await check(s, 'RPC writes', 'authored map: the second session\'s entry names it', OK, () =>
    eventually(() => s.execute(need(p.contexts.main, 'a context'), 'authored_get_owner', { key: 'second' }),
      (v) => lower(v) === lower(input.secondMyAccount), 'the second session as author'), (v) => v);
  const g1 = p.groups.restricted;
  await check(s, G, 'addGroupMembers', OK, () =>
    s.admin().addGroupMembers(need(g1, 'a restricted group'), { members: [{ identity: need(b, 'the second account'), role: 'Member' }] } as never));
  await check(s, G, 'updateMemberRole', OK, () => s.admin().updateMemberRole(need(g1, 'a restricted group'), need(b, 'the second account'), { role: 'Admin' }));
  await check(s, G, 'setMemberCapabilities', OK, () => s.admin().setMemberCapabilities(need(g1, 'a restricted group'), need(b, 'the second account'), { capabilities: 7 }));
  await check(s, G, 'getMemberCapabilities (another member)', OK, () =>
    eventually(() => s.admin().getMemberCapabilities(need(g1, 'a restricted group'), need(b, 'the second account')), (r) => r.capabilities === 7, 'the capabilities just set'), (v) => v);
  await check(s, G, 'removeGroupMembers', OK, () => s.admin().removeGroupMembers(need(g1, 'a restricted group'), { members: [need(b, 'the second account')] }));
  await check(s, G, 'addGroupMembers (a group the second session leaves)', OK, () =>
    s.admin().addGroupMembers(need(p.groups.leave, 'a group to leave'), { members: [{ identity: need(b, 'the second account'), role: 'Member' }] } as never));

  // What the second session did while this one listened, then a write for its
  // subscription to hear (s:leave).
  const ctx = p.contexts.main;
  await check(s, 'Events', 'the second session\'s write is heard (primary)', OK, () =>
    need(listeners(s).events, 'an event subscription').waitFor(need(input.secondEventMarker, 'the second session\'s write'), 'the second session\'s set'),
  (e) => ({ type: (e as { type?: string }).type }));
  await check(s, 'Presence', 'the second session\'s presence is seen (primary)', OK, () =>
    need(listeners(s).presence, 'a presence subscription').waitFor(need(input.secondPresence, 'the second session\'s presence'), 'the second session\'s presence'),
  (e) => ({ author: e.author, account: e.account, state: e.state }));
  const eventMarker = `event-primary-${s.run}-${tag()}`;
  await check(s, 'Events', 'set (primary, for the second session\'s subscription)', OK, () =>
    s.execute(need(ctx, 'a context'), 'set', { key: 'event-primary', value: eventMarker }));

  // The second session has downloaded the blob (s:join), so it can go.
  await check(s, 'Blobs', 'deleteBlob', NODE_ONLY, async () => {
    const r = await s.admin().deleteBlob(need(p.blob?.id, 'an uploaded blob'));
    assert(r.deleted, `not deleted: ${short(r)}`);
    return r;
  }, (v) => v);

  await teePolicy(s, p);
  return { eventMarker };
}

/**
 * Read the namespace's TEE admission policy and set it back unchanged: the rig's
 * relay is admitted under it (rig.py relay-join), so a different policy would
 * be the conformance run breaking its own rig.
 */
async function teePolicy(s: Session, p: Primary): Promise<void> {
  const T = 'TEE policy';
  const ns = p.namespaceId;
  const policy = await check(s, T, 'getTeeAdmissionPolicy', NODE_ONLY, async () => {
    const r = await s.admin().getTeeAdmissionPolicy(need(ns, 'a namespace'));
    assert(r.enabled !== false && r.acceptMock, `the namespace's policy is not the rig's (mock, relay mode): ${short(r)}`);
    return r;
  }, (v) => v);
  // An account is refused before the request is built, so the rig's own policy
  // stands in for the one it could not read.
  const same = policy ?? {
    allowedMrtd: ['0'.repeat(96)], allowedRtmr0: [], allowedRtmr1: ['0'.repeat(96)], allowedRtmr2: ['0'.repeat(96)],
    allowedRtmr3: ['0'.repeat(96)], allowedTcbStatuses: [], acceptMock: true, mode: 'relay' as const,
  };
  await check(s, T, 'setTeeAdmissionPolicy (the policy it holds, unchanged)', NODE_ONLY, async () => {
    await s.admin().setTeeAdmissionPolicy(need(ns, 'a namespace'), {
      allowedMrtd: same.allowedMrtd, allowedRtmr0: same.allowedRtmr0, allowedRtmr1: same.allowedRtmr1,
      allowedRtmr2: same.allowedRtmr2, allowedRtmr3: same.allowedRtmr3, allowedTcbStatuses: same.allowedTcbStatuses,
      acceptMock: same.acceptMock, ...(same.mode ? { mode: same.mode } : {}),
    });
    const after = await eventually(() => s.admin().getTeeAdmissionPolicy(need(ns, 'a namespace')),
      (r) => r.acceptMock === same.acceptMock && r.mode === same.mode && short(r.allowedMrtd) === short(same.allowedMrtd), 'the policy read back');
    return after;
  }, (v) => ({ mode: v.mode, acceptMock: v.acceptMock }));
}

export interface UpgradeInput {
  /** The application the namespace is upgraded to: the 0.0.1 bundle the rig installed on the node. */
  readonly targetApplicationId: string;
}

/**
 * The namespace, cascaded to its subgroups, onto the rig's 0.0.1 bundle; the
 * upgrade, migration and cascade status reads; and the main context read after
 * it (the bundle changes no state layout, so the value written in p:start must
 * still be there). `upgradeGroup` is `NODE_ONLY` for an account; the three
 * status reads are an account's too since core rc.76 (#4392), and on an
 * account, which upgraded nothing, they only have to answer.
 */
async function upgrade(s: Session, input: UpgradeInput): Promise<{ upgraded: boolean }> {
  const p = primary(s);
  const U = 'Upgrades';
  const ns = p.namespaceId;
  const up = await check(s, U, `upgradeGroup (the namespace, cascade, to ${UPGRADE_VERSION})`, NODE_ONLY, () =>
    s.admin().upgradeGroup(need(ns, 'a namespace'), { targetApplicationId: input.targetApplicationId, cascade: true }), (v) => v);
  // Polled on a node, where the upgrade is under way; an account upgraded nothing.
  const poll = <T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string) =>
    s.mode === 'account' ? read() : eventually(read, ok, what, 60_000);
  await check(s, U, 'getGroupUpgradeStatus', OK, () =>
    poll(() => s.admin().getGroupUpgradeStatus(need(ns, 'a namespace')),
      (r) => r?.toVersion === UPGRADE_VERSION && !/fail/i.test(r.status), `the namespace upgrading to ${UPGRADE_VERSION}`), (v) => v);
  // An account that administers the namespace reads it through the relay since
  // core rc.77 (#4400) checks the caller, not the relay.
  await check(s, U, 'getMigrationStatus', OK, () =>
    poll(() => s.admin().getMigrationStatus(need(ns, 'a namespace')), (r) => r.rollup.failed === 0, 'a migration rollup with no failures'),
  (v) => (v ? { targetVersion: v.targetVersion, expectedMembers: v.expectedMembers, rollup: v.rollup } : v));
  await check(s, U, 'getCascadeStatus', OK, () =>
    poll(() => s.admin().getCascadeStatus(need(ns, 'a namespace')), (r) => r.length > 0, 'a cascade snapshot per group'),
  (v) => (Array.isArray(v) ? v.map((e) => ({ group: e.groupId.slice(0, 8), status: e.upgrade.status, to: e.upgrade.toVersion })) : v));
  if (!up) return { upgraded: false };
  await check(s, U, 'the main context reads its state after the upgrade', OK, () =>
    eventually(() => s.execute(need(p.contexts.main, 'a context'), 'get', { key: 'conformance' }), (v) => v === p.values.public, 'the value written before the upgrade'),
  (v) => v);
  return { upgraded: true };
}

/** The second session's next call into the upgraded namespace: its node migrates and serves the same state. */
async function secondUpgraded(s: Session, input: JoinInput): Promise<void> {
  const st = input.start;
  await check(s, 'Upgrades', 'a second session reads state after the upgrade', OK, () =>
    eventually(() => s.execute(need(st.contexts.main, 'a context'), 'get', { key: 'conformance' }), (v) => v === st.values.public, 'the primary\'s value, after the upgrade', 60_000),
  (v) => v);
}

export interface LeaveInput extends JoinInput {
  /** What the primary wrote for this session's event subscription (p:members). */
  readonly primaryEventMarker?: string | null;
}

async function secondLeave(s: Session, input: LeaveInput): Promise<void> {
  const st = input.start;
  await check(s, 'Events', 'the primary\'s write is heard (second session)', OK, () =>
    need(listeners(s).events, 'an event subscription').waitFor(need(input.primaryEventMarker, 'the primary\'s write'), 'the primary\'s set'),
  (e) => ({ type: (e as { type?: string }).type }));
  stopListening(s);
  // A node's leaveContext is a local opt-out that publishes nothing; an account
  // has nothing local, so mero-react refuses it by name.
  await check(s, 'Contexts', 'leaveContext (the open subgroup\'s context)', NODE_ONLY, () => s.admin().leaveContext(need(st.contexts.inOpen, 'a context in an open subgroup')));
  // Joining an Open subgroup by inheritance records the join and adds no direct
  // row, so leaving that subgroup is refused, on a node exactly as here: the
  // membership is anchored in the parent.
  await check(s, 'Groups', 'leaveGroup (a subgroup it only inherits)', NOT_DIRECT_MEMBER, () => s.admin().leaveGroup(need(st.groups.inherit, 'the subgroup joined by inheritance')));
  await check(s, 'Groups', 'leaveGroup (a group it was added to)', OK, () => s.admin().leaveGroup(need(st.groups.leave, 'the group the second session was added to')));
  await check(s, 'Namespaces', 'leaveNamespace', OK, () => s.admin().leaveNamespace(need(st.namespaceId, 'a namespace')));
}

/** Close what `listen` opened. Presence is not retracted: the node sweeps a slot 7 s after its last refresh. */
function stopListening(s: Session) {
  const l = listening.get(s);
  l?.events?.stop();
  l?.presence?.stop();
  listening.delete(s);
}

async function teardown(s: Session): Promise<void> {
  const p = primary(s);
  const ns = p.namespaceId;
  stopListening(s);
  await check(s, 'Contexts', 'detachContextFromGroup', OK, () => s.admin().detachContextFromGroup(need(ns, 'a namespace'), need(p.contexts.detach, 'a context to detach')));
  await check(s, 'Contexts', 'deleteContext', NODE_ONLY, () => s.admin().deleteContext(need(p.contexts.main, 'a context')), (v) => v);
  await check(s, 'Groups', 'deleteGroup (the moved subgroup)', OK, () => s.admin().deleteGroup(need(p.groups.reparent, 'the moved group')), (v) => v);
  await check(s, 'Groups', 'deleteGroup', OK, () => s.admin().deleteGroup(need(p.groups.restricted, 'a restricted group')), (v) => v);
  await check(s, 'Namespaces', 'deleteNamespace', NODE_ONLY, () => {
    if (p.namespaceIsRig) throw new Blocked('createNamespace failed, and the rig\'s own namespace is not deleted');
    return s.admin().deleteNamespace(need(ns, 'a namespace'));
  }, (v) => v);
}

export const PHASES: Record<string, (s: Session, input: never) => Promise<unknown>> = {
  'p:start': start,
  'p:invite': invite,
  's:join': secondJoin,
  'p:members': members,
  'p:upgrade': upgrade,
  's:upgraded': secondUpgraded,
  's:leave': secondLeave,
  'p:teardown': teardown,
};

export type { Mode };
