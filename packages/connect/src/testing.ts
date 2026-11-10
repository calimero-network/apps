/**
 * An in-memory cluster for an org app's tests: organizations with members,
 * teams and a mode derived as core derives it (core#4890), app instances,
 * and the client calls the org-app module makes. Free of any test runner, so
 * each app's own vitest records nothing twice: every call is kept in
 * `calls`, and `callsOf(name)` reads them back.
 *
 *     import { orgCluster } from "@calimero-apps/connect/testing";
 *     const cluster = orgCluster({ me: "acct-me" });
 *     const org = cluster.addOrg({ mode: "shared", app: PKG, members: { "acct-bob": "member" } });
 */
import type { CalimeroClient } from "@calimero-network/mero-js";
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

  const raw = {
    session: { accountId: state.me } as { accountId: string },
    me: async () => {
      record("me", []);
      return {
        accountId: state.me,
        orgs: [...state.orgs.values()]
          .filter((o) => state.me in o.members)
          .map((o) => ({ orgId: o.orgId, name: o.name, role: o.members[state.me] })),
      };
    },
    getOrg: async (id: string) => {
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
    createOrg: async (name: string) => {
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
      return orgId;
    },
    deleteOrg: async (id: string, ...rest: unknown[]) => {
      record("deleteOrg", [id, ...rest]);
      state.orgs.delete(id);
    },
    setOrgMetadata: async (id: string, metadata: unknown) => {
      record("setOrgMetadata", [id, metadata]);
      org(id).metadata = metadata;
    },
    setMemberMetadata: async (id: string, account: string, metadata: unknown) => {
      record("setMemberMetadata", [id, account, metadata]);
      org(id).memberMetadata[account] = metadata;
    },
    setCapabilities: async (id: string, capabilities: number, ...rest: unknown[]) => {
      record("setCapabilities", [id, capabilities, ...rest]);
      const opts = rest[1] as { account?: string } | undefined;
      if (opts?.account) org(id).capabilities[opts.account] = capabilities;
      else org(id).defaultCapabilities = capabilities;
    },
    setMember: async (id: string, account: string, role: string, ...rest: unknown[]) => {
      record("setMember", [id, account, role, ...rest]);
      org(id).members[account] = role;
    },
    removeMember: async (id: string, account: string, ...rest: unknown[]) => {
      record("removeMember", [id, account, ...rest]);
      const o = org(id);
      delete o.members[account];
      for (const t of Object.values(o.teams)) delete t.members[account];
      return {};
    },
    createTeam: async (id: string, name: string, join: "everyone" | "invite" = "invite", parent: string | null = null) => {
      record("createTeam", [id, name, join, parent]);
      const teamId = `team-${(state.seq += 1)}`;
      org(id).teams[teamId] = { parent, members: { [state.me]: true }, join, removed: [], metadata: { name }, defaultCapabilities: null };
      return teamId;
    },
    setTeamMember: async (id: string, team: string, account: string, ...rest: unknown[]) => {
      record("setTeamMember", [id, team, account, ...rest]);
      const t = org(id).teams[team];
      if (!t) throw notFound(`team ${team}`);
      t.members[account] = (rest[1] as { lead?: boolean } | undefined)?.lead ?? false;
      t.removed = t.removed.filter((a) => a !== account);
    },
    removeTeamMember: async (id: string, team: string, account: string, ...rest: unknown[]) => {
      record("removeTeamMember", [id, team, account, ...rest]);
      const t = org(id).teams[team];
      if (!t) throw notFound(`team ${team}`);
      delete t.members[account];
      if (t.join === "everyone" && !t.removed.includes(account)) t.removed.push(account);
    },
    scopeApps: async (id: string, ...rest: unknown[]) => {
      record("scopeApps", [id, ...rest]);
      if (options.noAppTeams) throw notFound("route");
      const o = org(id);
      if (!ADMIN.has(o.members[state.me] ?? "")) {
        throw Object.assign(new Error("only the organization's owner and admins install apps in it"), { status: 400 });
      }
      const body = (rest[1] ?? {}) as { apps?: Array<{ package: string }>; shared?: boolean };
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
    listAppTeams: async (id: string) => {
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
    invite: async (id: string, role: string, ...rest: unknown[]) => {
      record("invite", [id, role, ...rest]);
      org(id);
      return `tok-${(state.seq += 1)}`;
    },
    createApp: async (name: string, source: unknown, opts: { org?: string; access?: Record<string, unknown> } = {}) => {
      record("createApp", [name, source, opts]);
      const appId = `app-${(state.seq += 1)}`;
      state.apps.set(appId, {
        appId,
        name,
        owner: state.me,
        org: opts.org ?? null,
        access: opts.access ?? (opts.org ? { kind: "org" } : { kind: "owner" }),
        package: pkgOf(source),
        bundle: typeof source === "string" ? source : "bundle-hash",
        metadata: null,
      });
      return appId;
    },
    getApp: async (id: string) => {
      record("getApp", [id]);
      const a = state.apps.get(id);
      if (!a) throw notFound(`app ${id}`);
      return structuredClone(a) as unknown as Record<string, unknown>;
    },
    listApps: async (filter: { bundle?: string; package?: string } = {}) => {
      record("listApps", [filter]);
      return [...state.apps.values()]
        .filter((a) => (!filter.package || a.package === filter.package) && (!filter.bundle || a.bundle === filter.bundle))
        .map((a) => ({ appId: a.appId, name: a.name, owner: a.owner, org: a.org, bundle: a.bundle, package: a.package, version: null }));
    },
    setAccess: async (id: string, access: Record<string, unknown>) => {
      record("setAccess", [id, access]);
      const a = state.apps.get(id);
      if (!a) throw notFound(`app ${id}`);
      a.access = access;
    },
    deleteApp: async (id: string) => {
      record("deleteApp", [id]);
      state.apps.delete(id);
    },
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

