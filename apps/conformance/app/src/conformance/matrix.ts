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
 *   s:leave     B leaves a context, a subgroup, the namespace
 *   p:teardown  detach, delete context, delete groups, delete namespace
 */
import type { AdminApiClient } from '@calimero-network/mero-react';
import { assert, Blocked, check, eventually, need, NODE_ONLY, OK, type RowContext } from './check';
import type { Mode } from './types';

/** What a phase reaches the session through; always the CURRENT admin and client. */
export interface Session extends RowContext {
  admin(): AdminApiClient;
  /** `rpc.execute` on the current client. */
  execute(contextId: string, method: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Wait until the session is connected again, after a call that reconnects it (an account's join). */
  settle(previousAdmin: AdminApiClient | null): Promise<void>;
}

/** State a primary run carries between its phases. */
interface Primary {
  account?: string;
  myAccount?: string;
  namespaceId?: string;
  namespaceIsRig?: boolean;
  groups: { restricted?: string; open?: string; inherit?: string; reparent?: string };
  contexts: { main?: string; inOpen?: string; detach?: string };
  values: { public?: string; user?: string; authoredKey?: string };
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

  if (s.mode === 'account') {
    // The account's first relay comes from the rig's invitation: before it, the
    // account is a member of nothing and holds no relay.
    const before = s.admin();
    await check(s, N, 'joinNamespace (rig invitation, first relay)', OK, async () => {
      const r = await before.joinNamespace(input.rigNamespaceId, { invitation: input.rigInvitation as never });
      await s.settle(before);
      return r;
    }, (v) => v);
  }

  const created = await check(s, N, 'createNamespace', OK, () =>
    s.admin().createNamespace({ applicationId: input.applicationId, name: `conformance-${tag()}` }), (v) => v);
  p.namespaceId = created?.namespaceId;
  p.namespaceIsRig = false;
  if (!p.namespaceId) {
    // The rest still says something on the rig's own namespace; teardown leaves it alone.
    p.namespaceId = input.rigNamespaceId;
    p.namespaceIsRig = true;
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

  return {
    namespaceId: p.namespaceId ?? null,
    namespaceIsRig: Boolean(p.namespaceIsRig),
    primaryAccount: p.account ?? null,
    primaryMyAccount: p.myAccount ?? null,
    contexts: p.contexts,
    groups: p.groups,
    values: p.values,
  };
}

async function invite(s: Session): Promise<{ invitation: unknown }> {
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
  return { invitation: (r as { invitation?: unknown } | undefined)?.invitation ?? null };
}

export interface JoinInput {
  readonly start: StartOutput;
  readonly invitation: unknown;
}

async function secondJoin(s: Session, input: JoinInput): Promise<{ account: string | null; myAccount: string | null }> {
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
  return { account, myAccount: my ?? null };
}

export interface MembersInput {
  readonly secondAccount: string | null;
  readonly secondMyAccount: string | null;
}

async function members(s: Session, input: MembersInput): Promise<void> {
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
}

async function secondLeave(s: Session, input: JoinInput): Promise<void> {
  const st = input.start;
  await check(s, 'Contexts', 'leaveContext (the open subgroup\'s context)', OK, () => s.admin().leaveContext(need(st.contexts.inOpen, 'a context in an open subgroup')));
  await check(s, 'Groups', 'leaveGroup', OK, () => s.admin().leaveGroup(need(st.groups.inherit, 'the subgroup joined by inheritance')));
  await check(s, 'Namespaces', 'leaveNamespace', OK, () => s.admin().leaveNamespace(need(st.namespaceId, 'a namespace')));
}

async function teardown(s: Session): Promise<void> {
  const p = primary(s);
  const ns = p.namespaceId;
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
  's:leave': secondLeave,
  'p:teardown': teardown,
};

export type { Mode };
