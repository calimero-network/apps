/**
 * An in-memory cluster for an org app's tests: organizations with members,
 * teams and a mode derived as core derives it (core#4890), app instances,
 * and the client calls the org-app module makes (the generated methods,
 * `client.orgs.get(...)`, recorded under the names of the wrappers they
 * replace, with the arguments in the wrappers' order). Free of any test runner, so
 * each app's own vitest records nothing twice: every call is kept in
 * `calls`, and `callsOf(name)` reads them back.
 *
 *     import { orgCluster } from "@calimero-apps/connect/testing";
 *     const cluster = orgCluster({ me: "acct-me" });
 *     const org = cluster.addOrg({ mode: "shared", app: PKG, members: { "acct-bob": "member" } });
 */
import type { CalimeroClient, MethodOptions } from "@calimero-network/mero-js";
export type ClusterMode = "legacy" | "standalone" | "shared";

export interface ClusterTeam {
  parent: string | null;
  /** account -> whether it leads the team. */
  members: Record<string, boolean>;
  join: "everyone" | "invite";
  removed: string[];
  metadata: unknown;
  defaultCapabilities: number | null;
}

export interface ClusterOrg {
  orgId: string;
  name: string;
  members: Record<string, string>;
  memberMetadata: Record<string, unknown>;
  defaultCapabilities: number;
  capabilities: Record<string, number>;
  metadata: unknown;
  teams: Record<string, ClusterTeam>;
}

export interface ClusterApp {
  appId: string;
  name: string;
  owner: string;
  org: string | null;
  access: Record<string, unknown>;
  package: string | null;
  bundle: string;
  metadata: unknown;
}

export interface OrgClusterOptions {
  /** The signed-in account. */
  me?: string;
  /** The node has no app-team routes (before core#4890): `listAppTeams`/`scopeApps` answer 404, `getOrg` has no `mode`. */
  noAppTeams?: boolean;
}

export interface AddOrgOptions {
  name?: string;
  /** `legacy`: no app team; `standalone`/`shared`: `app` has an open/closed team. */
  mode?: ClusterMode;
  /** The package given a team in a moded org (default: none, so only `otherApps` have teams). */
  app?: string | null;
  /** Other packages with teams in a moded org (default `com.calimero.other`). */
  otherApps?: string[];
  /** Everyone else in the org, account -> role. The signed-in account is `role`. */
  members?: Record<string, string>;
  role?: string;
  /** Direct rows on `app`'s team (a closed team holds only these; default: the signed-in account). */
  appTeamRows?: string[];
}

const ADMIN = new Set(["owner", "admin"]);

function notFound(what: string): Error {
  return Object.assign(new Error(`404 ${what}`), { status: 404 });
}

/** The cluster. Its `client` is what the app's code is handed. */
export function orgCluster(options: OrgClusterOptions = {}) {
  const state = {
    me: options.me ?? "acct-me",
    orgs: new Map<string, ClusterOrg>(),
    apps: new Map<string, ClusterApp>(),
    seq: 0,
    /** Set to an error to make the next passkey step-ups of these calls fail (a declined prompt). */
    declined: new Set<string>(),
  };
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string, args: unknown[]) => {
    calls.push([name, ...args]);
    if (state.declined.has(name)) throw Object.assign(new Error(`${name}: passkey declined`), { status: 412 });
  };
  const org = (id: string) => {
    const o = state.orgs.get(id);
    if (!o) throw notFound(`org ${id}`);
    return o;
  };
  const appTeamsOf = (o: ClusterOrg) =>
    Object.entries(o.teams).filter(
      ([, t]) => !t.parent && (t.metadata as { app?: { package?: unknown } } | null)?.app?.package,
    );
  const modeOf = (o: ClusterOrg): ClusterMode => {
    const teams = appTeamsOf(o);
    if (teams.length === 0) return "legacy";
    return teams.some(([, t]) => t.join === "invite") ? "shared" : "standalone";
  };
  const inTeam = (o: ClusterOrg, t: ClusterTeam, account: string) =>
    account in t.members ||
    (t.join === "everyone" &&
      account in o.members &&
      !t.removed.includes(account) &&
      !(o.members[account] === "guest" && modeOf(o) !== "legacy"));
  const pkgOf = (source: unknown) =>
    typeof source === "string" ? null : ((source as { package?: string } | null)?.package ?? null);

  const orgs = {
    get: async ({ org: id }: { org: string }) => {
      record("getOrg", [id]);
      const o = org(id);
      if (!(state.me in o.members)) throw notFound(`org ${id}`);
      const view = structuredClone(o) as ClusterOrg & { mode?: ClusterMode };
      // A closed team is seen by who is in it and by owners and admins.
      for (const [teamId, t] of Object.entries(view.teams)) {
        if (t.join === "invite" && !ADMIN.has(o.members[state.me] ?? "") && !(state.me in t.members)) {
          delete view.teams[teamId];
        }
      }
      if (!options.noAppTeams) view.mode = modeOf(o);
      return { releaseApprovers: [], publishes: [], newWorkStopped: null, ...view };
    },
    create: async ({ name }: { name: string }) => {
      record("createOrg", [name]);
      const orgId = `org-${(state.seq += 1)}`;
      state.orgs.set(orgId, {
        orgId,
        name,
        members: { [state.me]: "owner" },
        memberMetadata: {},
        defaultCapabilities: 4,
        capabilities: {},
        metadata: null,
        teams: {},
      });
      return { orgId };
    },
    delete: async ({ org: id }: { org: string }, opts?: Opts) => {
      record("deleteOrg", [id, opts]);
      state.orgs.delete(id);
      return {};
    },
    metadata: async ({ org: id, metadata }: { org: string; metadata: unknown }) => {
      record("setOrgMetadata", [id, metadata]);
      org(id).metadata = metadata;
      return {};
    },
    memberMetadata: async ({ org: id, account, metadata }: { org: string; account: string; metadata: unknown }) => {
      record("setMemberMetadata", [id, account, metadata]);
      org(id).memberMetadata[account] = metadata;
      return {};
    },
    capabilities: async (
      { org: id, capabilities, ...at }: { org: string; capabilities: number; account?: string; team?: string },
      opts?: Opts,
    ) => {
      record("setCapabilities", [id, capabilities, opts, at]);
      if (at.account) org(id).capabilities[at.account] = capabilities;
      else org(id).defaultCapabilities = capabilities;
      return {};
    },
    setMember: async ({ org: id, account, role }: { org: string; account: string; role: string }, opts?: Opts) => {
      record("setMember", [id, account, role, opts]);
      org(id).members[account] = role;
      return {};
    },
    removeMember: async ({ org: id, account }: { org: string; account: string }, opts?: Opts) => {
      record("removeMember", [id, account, opts]);
      const o = org(id);
      delete o.members[account];
      for (const t of Object.values(o.teams)) delete t.members[account];
      return {};
    },
    teamCreate: async ({
      org: id,
      name,
      join = "invite",
      parent = null,
    }: {
      org: string;
      name: string;
      join?: "everyone" | "invite";
      parent?: string | null;
    }) => {
      record("createTeam", [id, name, join, parent]);
      const teamId = `team-${(state.seq += 1)}`;
      org(id).teams[teamId] = { parent, members: { [state.me]: true }, join, removed: [], metadata: { name }, defaultCapabilities: null };
      return { teamId };
    },
    teamSetMember: async (
      { org: id, team, account, ...row }: { org: string; team: string; account: string; role?: string; lead?: boolean; capabilities?: number },
      opts?: Opts,
    ) => {
      record("setTeamMember", [id, team, account, opts, row]);
      const t = org(id).teams[team];
      if (!t) throw notFound(`team ${team}`);
      t.members[account] = row.lead ?? false;
      t.removed = t.removed.filter((a) => a !== account);
      return {};
    },
    teamRemoveMember: async ({ org: id, team, account }: { org: string; team: string; account: string }, opts?: Opts) => {
      record("removeTeamMember", [id, team, account, opts]);
      const t = org(id).teams[team];
      if (!t) throw notFound(`team ${team}`);
      delete t.members[account];
      if (t.join === "everyone" && !t.removed.includes(account)) t.removed.push(account);
      return {};
    },
    appTeamsScope: async (
      { org: id, ...body }: { org: string; apps?: Array<{ package: string }>; shared?: boolean },
      opts?: Opts,
    ) => {
      record("scopeApps", [id, opts, body]);
      if (options.noAppTeams) throw notFound("route");
      const o = org(id);
      if (!ADMIN.has(o.members[state.me] ?? "")) {
        throw Object.assign(new Error("only the organization's owner and admins install apps in it"), { status: 400 });
      }
      const teams = [];
      for (const { package: pkg } of body.apps ?? []) {
        let teamId = appTeamsOf(o).find(([, t]) => (t.metadata as { app: { package: string } }).app.package === pkg)?.[0];
        const created = !teamId;
        if (!teamId) {
          teamId = `team-${pkg.split(".").pop()}`;
          o.teams[teamId] = {
            parent: null,
            members: { [state.me]: true },
            join: "everyone",
            removed: [],
            metadata: { app: { package: pkg, name: pkg } },
            defaultCapabilities: 2,
          };
        }
        const moved: string[] = [];
        for (const a of state.apps.values()) {
          if (a.org === id && a.package === pkg && a.access.kind === "org") {
            a.access = { kind: "team", team: teamId };
            moved.push(a.appId);
          }
        }
        teams.push({ package: pkg, teamId, created, apps: moved, added: 0 });
      }
      const shared = body.shared ?? appTeamsOf(o).length >= 2;
      if (shared) {
        for (const [, t] of appTeamsOf(o)) {
          if (t.join === "everyone") {
            for (const [account, role] of Object.entries(o.members)) {
              if (role !== "guest" && !t.removed.includes(account) && !(account in t.members)) t.members[account] = false;
            }
            t.join = "invite";
          }
        }
      }
      return { mode: modeOf(o), teams };
    },
    appTeamList: async ({ org: id }: { org: string }) => {
      record("listAppTeams", [id]);
      if (options.noAppTeams) throw notFound("route");
      const o = org(id);
      if (!(state.me in o.members)) throw notFound(`org ${id}`);
      return {
        mode: modeOf(o),
        appTeams: appTeamsOf(o).map(([teamId, t]) => ({
          package: (t.metadata as { app: { package: string } }).app.package,
          teamId,
          name: teamId,
          join: t.join,
          memberCount: Object.keys(o.members).filter((a) => inTeam(o, t, a)).length,
          defaultCapabilities: t.defaultCapabilities,
          member: inTeam(o, t, state.me),
          manages: ADMIN.has(o.members[state.me] ?? "") || t.members[state.me] === true,
        })),
      };
    },
    inviteCreate: async (
      { org: id, role, teams, ...extra }: { org: string; role: string; teams?: string[]; ttlSecs?: number; uses?: number },
      opts?: Opts,
    ) => {
      // No team and no extra recorded as `undefined`, where the wrapper took none.
      record("invite", [id, role, opts, teams?.length ? teams : undefined, Object.keys(extra).length ? extra : undefined]);
      org(id);
      return { token: `tok-${(state.seq += 1)}` };
    },
  };

  const apps = {
    create: async (args: { name: string; org?: string; access?: Record<string, unknown> } & Record<string, unknown>) => {
      const { source, rest } = createTarget(args);
      record("createApp", [args.name, source, rest]);
      const appId = `app-${(state.seq += 1)}`;
      state.apps.set(appId, {
        appId,
        name: args.name,
        owner: state.me,
        org: args.org ?? null,
        access: args.access ?? (args.org ? { kind: "org" } : { kind: "owner" }),
        package: pkgOf(source),
        bundle: typeof source === "string" ? source : "bundle-hash",
        metadata: null,
      });
      return { appId };
    },
    get: async ({ app: id }: { app: string }) => {
      record("getApp", [id]);
      const a = state.apps.get(id);
      if (!a) throw notFound(`app ${id}`);
      return structuredClone(a) as unknown as Record<string, unknown>;
    },
    list: async (filter: { bundle?: string; package?: string } = {}) => {
      record("listApps", [filter]);
      return {
        apps: [...state.apps.values()]
          .filter((a) => (!filter.package || a.package === filter.package) && (!filter.bundle || a.bundle === filter.bundle))
          .map((a) => ({ appId: a.appId, name: a.name, owner: a.owner, org: a.org, bundle: a.bundle, package: a.package, version: null })),
      };
    },
    access: async ({ app: id, access }: { app: string; access: Record<string, unknown> }) => {
      record("setAccess", [id, access]);
      const a = state.apps.get(id);
      if (!a) throw notFound(`app ${id}`);
      a.access = access;
      return {};
    },
    /** A contract call: answered empty (the app's own tests cover its contract). */
    call: async ({ app, method, ...rest }: { app: string; method: string; args?: unknown }, opts?: Opts) => {
      record("call", [app, method, rest.args, opts]);
      return { index: 1, result: null, events: [] };
    },
    delete: async ({ app: id }: { app: string }) => {
      record("deleteApp", [id]);
      state.apps.delete(id);
      return {};
    },
  };

  const raw = {
    session: { accountId: state.me } as { accountId: string },
    auth: {
      me: async () => {
        record("me", []);
        return {
          accountId: state.me,
          orgs: [...state.orgs.values()]
            .filter((o) => state.me in o.members)
            .map((o) => ({ orgId: o.orgId, name: o.name, role: o.members[state.me] })),
        };
      },
    },
    orgs,
    apps,
  };

  /** An org made elsewhere: legacy, or with app teams (`app`'s, and `otherApps`'). */
  function addOrg(opts: AddOrgOptions = {}): string {
    const orgId = `org-x${(state.seq += 1)}`;
    const mode = opts.mode ?? "legacy";
    const members = { [state.me]: opts.role ?? "owner", ...(opts.members ?? {}) };
    const teams: Record<string, ClusterTeam> = {};
    if (mode !== "legacy") {
      const join = mode === "shared" ? "invite" : "everyone";
      for (const pkg of opts.otherApps ?? ["com.calimero.other"]) {
        teams[`team-${pkg.split(".").pop()}`] = {
          parent: null,
          members: {},
          join,
          removed: [],
          metadata: { app: { package: pkg, name: pkg } },
          defaultCapabilities: null,
        };
      }
      if (opts.app) {
        teams[`team-${opts.app.split(".").pop()}`] = {
          parent: null,
          members: Object.fromEntries((opts.appTeamRows ?? [state.me]).map((a) => [a, false])),
          join,
          removed: [],
          metadata: { app: { package: opts.app, name: opts.app } },
          defaultCapabilities: null,
        };
      }
    }
    state.orgs.set(orgId, {
      orgId,
      name: opts.name ?? "Elsewhere",
      members,
      memberMetadata: {},
      defaultCapabilities: 4 | 1,
      capabilities: {},
      metadata: null,
      teams,
    });
    return orgId;
  }

  /** An admin keeps the org's apps apart (Calimero Home): every app team closed, its people kept. */
  function keepAppsApart(orgId: string, rows: Record<string, string[]> = {}): void {
    const o = org(orgId);
    for (const [teamId, t] of appTeamsOf(o)) {
      if (t.join === "everyone") {
        for (const account of rows[teamId] ?? Object.keys(o.members)) if (!(account in t.members)) t.members[account] = false;
      }
      t.join = "invite";
    }
  }

  /** Signs in as another account. */
  function signInAs(account: string): void {
    state.me = account;
    raw.session.accountId = account;
  }

  /** The team id `pkg` has in `orgId`, or `null`. */
  function teamOf(orgId: string, pkg: string): string | null {
    return appTeamsOf(org(orgId)).find(([, t]) => (t.metadata as { app: { package: string } }).app.package === pkg)?.[0] ?? null;
  }

  return {
    state,
    /** The client the app's code is handed (`CalimeroClient` for its types; only the calls above answer). */
    client: raw as unknown as CalimeroClient,
    calls,
    callsOf: (name: string) => calls.filter((c) => c[0] === name).map((c) => c.slice(1)),
    modeOf: (orgId: string) => modeOf(org(orgId)),
    org,
    addOrg,
    keepAppsApart,
    signInAs,
    teamOf,
  };
}

export type OrgCluster = ReturnType<typeof orgCluster>;


// ── a fake written by the wrapper names ─────────────────────────────────────

type Args = Record<string, unknown>;
type Opts = MethodOptions | undefined;

/** `createApp`'s target as the wrapper took it: a bundle hash, or the package (and version, ...). */
function createTarget(args: Args): { source: unknown; rest: Args } {
  const { name: _name, bundle, package: pkg, version, service, deployment, ...rest } = args;
  const source =
    typeof bundle === "string"
      ? bundle
      : Object.fromEntries(Object.entries({ package: pkg, version, service, deployment }).filter(([, v]) => v !== undefined));
  return { source, rest };
}

/** Bytes from a `presenceState` hex string, `null` kept (a retraction). */
function presenceBytes(state: unknown): Uint8Array | null {
  if (typeof state !== "string") return null;
  const out = new Uint8Array(state.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(state.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Each generated method by the wrapper it replaces: `[group, method, wrapper,
 * the wrapper's arguments from the method's, the method's answer from the
 * wrapper's]`. A step-up's per-call options take the passkey's place.
 */
const ROUTES: Array<[string, string, string, (a: Args, o: Opts) => unknown[], ((r: unknown) => unknown)?]> = [
  ["auth", "me", "me", () => []],
  ["auth", "apikeyList", "listApiKeys", () => [], (keys) => ({ keys })],
  ["auth", "apikeyCreate", "createApiKey", (a, o) => [a, o]],
  ["auth", "apikeyRevoke", "revokeApiKey", (a, o) => [a.key, o]],
  ["auth", "passkeyRemove", "removePasskey", (a, o) => [a.cred, o]],
  ["auth", "passkeyLabel", "labelPasskey", (a) => [a.cred, a.label]],
  ["deployments", "signUpPublic", "signUpPolicy", () => []],
  ["packages", "get", "package", (a) => [a.package]],
  ["packages", "list", "packages", () => [], (packages) => ({ packages })],
  ["packages", "upload", "uploadPackage", (a) => [a.body]],
  ["packages", "bundlePut", "uploadBundle", (a) => [a.body], (hash) => ({ hash })],
  ["consent", "pageCreate", "requestConsent", (a) => [a.body]],
  ["consent", "pageResult", "consentResult", (a) => [a.request]],
  ["apps", "get", "getApp", (a) => [a.app]],
  ["apps", "list", "listApps", (a) => [a ?? {}], (apps) => ({ apps })],
  [
    "apps",
    "create",
    "createApp",
    (a) => {
      const { source, rest } = createTarget(a);
      return [a.name, source, Object.keys(rest).length ? rest : undefined];
    },
    (appId) => ({ appId }),
  ],
  ["apps", "delete", "deleteApp", (a) => [a.app]],
  ["apps", "metadata", "setAppMetadata", (a) => [a.app, a.metadata]],
  ["apps", "access", "setAccess", (a) => [a.app, a.access]],
  ["apps", "abi", "appAbi", (a) => [a.app]],
  ["apps", "call", "call", (a) => [a.app, a.method, a.args, a.idempotencyKey]],
  [
    "apps",
    "view",
    "view",
    (a) => [
      a.app,
      a.method,
      a.args,
      a.consistency === "stale" || a.minIndex !== undefined
        ? { ...(a.consistency === "stale" ? { stale: true } : {}), ...(a.minIndex !== undefined ? { minIndex: a.minIndex } : {}) }
        : undefined,
    ],
  ],
  ["apps", "presencePublish", "publishPresence", (a) => [a.app, a.seq, presenceBytes(a.state)]],
  ["apps", "presenceGet", "presence", (a) => [a.app], (present) => ({ present })],
  // The wrapper's default type is left off, as a caller left it.
  ["apps", "blobUpload", "uploadBlob", (a) => [a.app, a.body, a.contentType === "application/octet-stream" ? undefined : a.contentType]],
  ["apps", "blobInfo", "blobInfo", (a) => [a.app, a.id]],
  ["apps", "blobList", "listBlobs", (a) => [a.app], (blobs) => ({ blobs })],
  ["apps", "blobDelete", "deleteBlob", (a) => [a.app, a.id]],
  ["apps", "upgrade", "upgradeApp", ({ app, ...target }, o) => [app, target, o]],
  ["orgs", "get", "getOrg", (a) => [a.org]],
  ["orgs", "create", "createOrg", ({ name, ...options }) => [name, Object.keys(options).length ? options : undefined], (orgId) => ({ orgId })],
  ["orgs", "delete", "deleteOrg", (a, o) => [a.org, o]],
  ["orgs", "metadata", "setOrgMetadata", (a) => [a.org, a.metadata]],
  ["orgs", "memberMetadata", "setMemberMetadata", (a) => [a.org, a.account, a.metadata]],
  ["orgs", "capabilities", "setCapabilities", ({ org, capabilities, ...at }, o) => [org, capabilities, o, Object.keys(at).length ? at : undefined]],
  ["orgs", "setMember", "setMember", (a, o) => [a.org, a.account, a.role, o]],
  ["orgs", "removeMember", "removeMember", (a, o) => [a.org, a.account, o]],
  ["orgs", "teamCreate", "createTeam", (a) => [a.org, a.name, a.join, a.parent], (teamId) => ({ teamId })],
  ["orgs", "teamGet", "getTeam", (a) => [a.org, a.team]],
  ["orgs", "teamUpdate", "updateTeam", ({ org, team, ...update }) => [org, team, update]],
  ["orgs", "teamDelete", "deleteTeam", (a, o) => [a.org, a.team, o]],
  [
    "orgs",
    "teamSetMember",
    "setTeamMember",
    ({ org, team, account, ...row }, o) => [org, team, account, o, Object.keys(row).length ? row : undefined],
  ],
  ["orgs", "teamRemoveMember", "removeTeamMember", (a, o) => [a.org, a.team, a.account, o]],
  // No team is the wrapper's default (`teams = []`), left off as a caller left it.
  [
    "orgs",
    "inviteCreate",
    "invite",
    ({ org, role, teams, ...extra }, o) => [
      org,
      role,
      o,
      Array.isArray(teams) && teams.length === 0 ? undefined : teams,
      Object.keys(extra).length ? extra : undefined,
    ],
    (token) => ({ token }),
  ],
  ["orgs", "inviteRedeem", "redeemInvite", (a) => [a.token]],
  ["orgs", "inviteList", "listInvites", (a) => [a.org], (invites) => ({ invites })],
  ["orgs", "inviteRevoke", "revokeInvite", (a, o) => [a.org, a.key, o]],
  ["orgs", "appTeamList", "listAppTeams", (a) => [a.org]],
  ["orgs", "appTeamsScope", "scopeApps", ({ org, ...body }, o) => [org, o, body]],
];

/**
 * A test's fake client written by the wrapper names mero-js retired
 * (`getOrg(org)`, `me()`, `invite(org, role, passkey, teams)`, ...), with the
 * generated methods the code under test calls (`orgs.get({ org })`, ...) on
 * it: each calls the fake's own function of the old name with the arguments
 * in the wrapper's order (its per-call options where the passkey was), and
 * answers what the generated method answers (`{ token }` for a token). A
 * method whose wrapper the fake does not define is left out, as the wrapper
 * was, so a test of "a client without X" still holds. The fake's own
 * functions stay on it, so a test asserts on them as before.
 */
export function withRoutes<T extends object>(fake: T): T & CalimeroClient {
  const own = fake as Record<string, unknown>;
  for (const [group, method, wrapper, args, answer] of ROUTES) {
    const call = async (a: Args = {}, o?: Opts) => {
      // A team's default capabilities reach the fake's `setTeamDefaultCapabilities`, when it has one.
      if (method === "capabilities" && a.team && !a.account && typeof own.setTeamDefaultCapabilities === "function") {
        return (own.setTeamDefaultCapabilities as (...x: unknown[]) => unknown).apply(fake, [a.org, a.team, a.capabilities, o]);
      }
      // A confirmed contract call reaches the fake's `callConfirmed`, when it has one.
      if (method === "call" && o?.confirm && typeof own.callConfirmed === "function") {
        const given = [a.app, a.method, a.args, o, a.idempotencyKey];
        while (given.length > 0 && given[given.length - 1] === undefined) given.pop();
        return (own.callConfirmed as (...x: unknown[]) => unknown).apply(fake, given);
      }
      // Trailing arguments the wrapper was not given are left off, as a caller left them.
      const given = args(a, o);
      while (given.length > 0 && given[given.length - 1] === undefined) given.pop();
      const r = await (own[wrapper] as (...x: unknown[]) => unknown).apply(fake, given);
      return answer ? answer(r) : r;
    };
    // A function there (the `packages()` wrapper) takes the group too, as on the client.
    const existing = own[group];
    let target = (typeof existing === "object" && existing) || typeof existing === "function" ? existing : undefined;
    if (!target) {
      // Not enumerable, so a test that walks its fake's own mocks does not meet the groups.
      target = {};
      Object.defineProperty(own, group, { value: target, configurable: true, enumerable: false, writable: true });
    }
    // Read when called for, so a wrapper the test adds later (`Object.assign(client, { getOrg })`) is routed too.
    Object.defineProperty(target, method, {
      configurable: true,
      enumerable: true,
      get: () => {
        const alt = method === "capabilities" ? "setTeamDefaultCapabilities" : method === "call" ? "callConfirmed" : null;
        return typeof own[wrapper] === "function" || (alt && typeof own[alt] === "function") ? call : undefined;
      },
    });
  }
  return fake as T & CalimeroClient;
}
