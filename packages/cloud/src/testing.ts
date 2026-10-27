/**
 * An in-memory Calimero Cloud cluster for app tests: the release-v2 REST routes
 * the cloud client calls (accounts, organizations, teams, invites, app
 * instances, packages), answered from plain objects, so a test drives an app's
 * real admin code through `@calimero-apps/cloud` without a node or a quote.
 *
 * ```ts
 * const cluster = installFakeCluster();      // patches CloudMero for this test
 * cluster.signIn('alice');
 * await createWorld(...);                     // the app's own code
 * expect(cluster.calls).toContainEqual(['POST', 'orgs', { name: 'w' }]);
 * cluster.uninstall();
 * ```
 *
 * It mirrors merod-v2's answers (`crates/cloud-node/src/api.rs`) closely
 * enough for app logic; it does not check access control beyond membership.
 */

import { CloudMero, CloudRpc, contextIdOf } from './backend.ts';
import { HTTPError } from './vendor/errors.js';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = [method: string, path: string, body: unknown];

interface FakeTeam {
  teamId: string;
  name: string;
  parent: string | null;
  join: 'everyone' | 'invite';
  metadata: Json;
  members: Map<string, 'lead' | 'member' | 'readOnly'>;
}
interface FakeOrg {
  orgId: string;
  name: string;
  members: Map<string, 'owner' | 'admin' | 'member' | 'guest'>;
  teams: Map<string, FakeTeam>;
  defaultCapabilities: number;
  capabilities: Map<string, number>;
}
interface FakeApp {
  appId: string;
  contextId: string;
  name: string;
  owner: string;
  org: string | null;
  access: Json;
  bundle: string;
  package?: string;
  version?: string;
  initArgs: Json;
}


export interface FakeCluster {
  /** Every request, in order: `[method, path, body]`. */
  readonly calls: Call[];
  readonly orgs: Map<string, FakeOrg>;
  readonly apps: Map<string, FakeApp>;
  readonly packages: Map<string, string[]>;
  /** The account requests are made as. */
  signIn(account: string): void;
  /** Answer app calls (`rpc.execute`) and views (`rpc.view`). */
  onCall(handler: (call: { contextId: string; method: string; args: Json; caller: string }) => unknown): void;
  /** Make the next request to `path` (a prefix) fail with `status`. */
  failNext(pathPrefix: string, status: number, message?: string): void;
  uninstall(): void;
}

let seq = 0;
const id = (prefix: string) => `${prefix}${++seq}`;

/** Patch `CloudMero` and `CloudRpc` to answer from an in-memory cluster. */
export function installFakeCluster(): FakeCluster {
  const calls: Call[] = [];
  const orgs = new Map<string, FakeOrg>();
  const apps = new Map<string, FakeApp>();
  const packages = new Map<string, string[]>();
  const failures: Array<{ prefix: string; status: number; message: string }> = [];
  let caller = 'me';
  let handler: (c: { contextId: string; method: string; args: Json; caller: string }) => unknown = () => null;

  // What `CloudMero.request` throws for a refusal: v1's `HTTPError`, the
  // cluster's message as its body.
  const fail = (status: number, message: string): never => {
    throw new HTTPError(status, 'ERROR', '', new Headers(), JSON.stringify({ error: message }));
  };
  const orgOf = (orgId: string): FakeOrg => {
    const o = orgs.get(orgId);
    if (!o || !o.members.has(caller)) fail(404, 'no such organization');
    return o!;
  };
  const teamOf = (o: FakeOrg, teamId: string): FakeTeam => o.teams.get(teamId) ?? fail(404, 'no such team');
  const appOf = (key: string): FakeApp =>
    apps.get(key) ?? [...apps.values()].find((a) => a.contextId === key) ?? fail(404, 'no such app');
  const teamView = (o: FakeOrg, t: FakeTeam): Json => ({
    teamId: t.teamId,
    name: t.name,
    parent: t.parent,
    join: t.join,
    metadata: t.metadata,
    members: [...t.members].map(([account, role]) => ({ account, role, capabilities: o.capabilities.get(account) ?? o.defaultCapabilities })),
    children: [...o.teams.values()].filter((c) => c.parent === t.teamId).map((c) => c.teamId),
    apps: [...apps.values()].filter((a) => a.org === o.orgId && a.access?.kind === 'team' && a.access.team === t.teamId).map((a) => ({ appId: a.appId, name: a.name, contextId: a.contextId })),
    member: t.members.has(caller) || (t.join === 'everyone' && o.members.has(caller)),
  });
  const appView = (a: FakeApp): Json => ({ appId: a.appId, name: a.name, owner: a.owner, org: a.org, bundle: a.bundle, package: a.package ?? null, version: a.version ?? null, access: a.access });
  const reaches = (a: FakeApp): boolean => {
    if (a.owner === caller) return true;
    if (!a.org) return false;
    const o = orgs.get(a.org);
    if (!o?.members.has(caller)) return false;
    if (a.access?.kind !== 'team') return true;
    const t = o.teams.get(a.access.team);
    return !!t && (t.members.has(caller) || t.join === 'everyone');
  };

  async function route(method: string, path: string, body: Json): Promise<Json> {
    calls.push([method, path, body]);
    const f = failures.findIndex((x) => path.startsWith(x.prefix));
    if (f >= 0) {
      const [x] = failures.splice(f, 1);
      fail(x!.status, x!.message);
    }
    const p = path.split('?')[0]!.split('/').map(decodeURIComponent);
    const is = (m: string, ...shape: string[]) => method === m && p.length === shape.length && shape.every((s, i) => s === '*' || s === p[i]);

    if (is('GET', 'auth', 'me')) {
      return { accountId: caller, name: caller, passkeys: [], orgs: [...orgs.values()].filter((o) => o.members.has(caller)).map((o) => ({ orgId: o.orgId, name: o.name, role: o.members.get(caller) })) };
    }
    if (is('POST', 'orgs')) {
      const orgId = id('org');
      orgs.set(orgId, { orgId, name: body.name, members: new Map([[caller, 'owner']]), teams: new Map(), defaultCapabilities: 4, capabilities: new Map() });
      return { orgId };
    }
    if (is('GET', 'orgs', '*')) {
      const o = orgOf(p[1]!);
      return { orgId: o.orgId, name: o.name, members: Object.fromEntries(o.members), teams: Object.fromEntries([...o.teams].map(([k, t]) => [k, { teamId: t.teamId, name: t.name, parent: t.parent, join: t.join, metadata: t.metadata }])), defaultCapabilities: o.defaultCapabilities, capabilities: Object.fromEntries(o.capabilities) };
    }
    if (is('DELETE', 'orgs', '*')) {
      orgOf(p[1]!);
      orgs.delete(p[1]!);
      return {};
    }
    if (is('POST', 'orgs', '*', 'members')) {
      orgOf(p[1]!).members.set(body.account, body.role);
      return {};
    }
    if (is('DELETE', 'orgs', '*', 'members', '*')) {
      orgOf(p[1]!).members.delete(p[3]!);
      return {};
    }
    if (is('POST', 'orgs', '*', 'capabilities')) {
      const o = orgOf(p[1]!);
      if (body.account) o.capabilities.set(body.account, body.capabilities);
      else o.defaultCapabilities = body.capabilities;
      return {};
    }
    if (is('POST', 'orgs', '*', 'teams')) {
      const o = orgOf(p[1]!);
      const teamId = id('team');
      o.teams.set(teamId, { teamId, name: body.name, parent: body.parent ?? null, join: body.join, metadata: null, members: new Map([[caller, 'lead']]) });
      return { teamId };
    }
    if (is('GET', 'orgs', '*', 'teams', '*')) {
      const o = orgOf(p[1]!);
      return teamView(o, teamOf(o, p[3]!));
    }
    if (is('POST', 'orgs', '*', 'teams', '*')) {
      const t = teamOf(orgOf(p[1]!), p[3]!);
      if (body.name !== undefined) t.name = body.name;
      if (body.join !== undefined) t.join = body.join;
      if ('parent' in body) t.parent = body.parent;
      if (body.metadata !== undefined) t.metadata = body.metadata;
      return {};
    }
    if (is('DELETE', 'orgs', '*', 'teams', '*')) {
      orgOf(p[1]!).teams.delete(p[3]!);
      return {};
    }
    if (is('POST', 'orgs', '*', 'teams', '*', 'members')) {
      teamOf(orgOf(p[1]!), p[3]!).members.set(body.account, body.role ?? 'member');
      return {};
    }
    if (is('DELETE', 'orgs', '*', 'teams', '*', 'members', '*')) {
      teamOf(orgOf(p[1]!), p[3]!).members.delete(p[5]!);
      return {};
    }
    if (is('POST', 'orgs', '*', 'invites')) {
      orgOf(p[1]!);
      return { token: `inv_${p[1]}_${(body.teams ?? []).join('+')}_${++seq}` };
    }
    if (is('POST', 'invites', '*', 'redeem')) {
      const m = /^inv_(.+?)_(.*)_\d+$/.exec(p[1]!);
      const o = m ? orgs.get(m[1]!) : undefined;
      if (!o) fail(410, 'invitation expired or unknown');
      if (!o!.members.has(caller)) o!.members.set(caller, 'member');
      for (const team of (m![2] ?? '').split('+').filter(Boolean)) o!.teams.get(team)?.members.set(caller, 'member');
      return { orgId: o!.orgId };
    }
    if (is('POST', 'apps')) {
      const appId = id('app');
      const bundle = body.bundle ?? `bundle-of-${body.package}`;
      apps.set(appId, { appId, contextId: await contextIdOf(appId), name: body.name, owner: caller, org: body.org ?? null, access: body.access ?? { kind: 'owner' }, bundle, package: body.package, version: body.version, initArgs: body.initArgs });
      return { appId };
    }
    if (is('GET', 'apps')) {
      return { apps: [...apps.values()].filter(reaches).map(appView) };
    }
    if (is('GET', 'apps', '*')) {
      const a = appOf(p[1]!);
      if (!reaches(a)) fail(404, 'no such app');
      return appView(a);
    }
    if (is('DELETE', 'apps', '*')) {
      apps.delete(appOf(p[1]!).appId);
      return { deleted: true };
    }
    if (is('POST', 'apps', '*', 'upgrade')) {
      const a = appOf(p[1]!);
      if (body.version) a.version = body.version;
      if (body.bundle) a.bundle = body.bundle;
      return {};
    }
    if (is('GET', 'packages', '*')) {
      const versions = packages.get(p[1]!);
      if (!versions) fail(404, 'no such package');
      return { package: p[1], versions: versions!.map((version) => ({ version })) };
    }
    if (is('POST', 'packages', 'install')) {
      packages.set(body.package, [...(packages.get(body.package) ?? []), body.version]);
      return { package: body.package, version: body.version };
    }
    return fail(404, `the fake cluster has no route ${method} ${path}`);
  }

  const original = {
    get: CloudMero.prototype.get,
    post: CloudMero.prototype.post,
    delete: CloudMero.prototype.delete,
    whoami: CloudMero.prototype.whoami,
    execute: CloudRpc.prototype.execute,
    view: CloudRpc.prototype.view,
  };
  const proto = CloudMero.prototype as Json;
  proto.get = function (path: string) {
    return route('GET', path, undefined);
  };
  proto.post = function (path: string, body: unknown = {}) {
    return route('POST', path, body);
  };
  proto.delete = function (path: string) {
    return route('DELETE', path, undefined);
  };
  proto.whoami = function () {
    return route('GET', 'auth/me', undefined);
  };
  const rpc = CloudRpc.prototype as Json;
  rpc.execute = async function (params: { contextId: string; method: string; argsJson?: Json }) {
    calls.push(['CALL', `apps/${params.contextId}/intents`, { method: params.method, args: params.argsJson ?? {} }]);
    return handler({ contextId: params.contextId, method: params.method, args: params.argsJson ?? {}, caller });
  };
  rpc.view = async function (params: { contextId: string; method: string; argsJson?: Json }) {
    calls.push(['VIEW', `apps/${params.contextId}/views`, { method: params.method, args: params.argsJson ?? {} }]);
    return handler({ contextId: params.contextId, method: params.method, args: params.argsJson ?? {}, caller });
  };

  return {
    calls,
    orgs,
    apps,
    packages,
    signIn(account) {
      caller = account;
    },
    onCall(h) {
      handler = h;
    },
    failNext(prefix, status, message = `HTTP ${status}`) {
      failures.push({ prefix, status, message });
    },
    uninstall() {
      Object.assign(proto, { get: original.get, post: original.post, delete: original.delete, whoami: original.whoami });
      Object.assign(rpc, { execute: original.execute, view: original.view });
    },
  };
}
