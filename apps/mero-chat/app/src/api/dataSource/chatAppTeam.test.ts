import { beforeEach, describe, expect, it, vi } from "vitest";

// Chat's own app team (core#4890): a cluster in memory whose orgs have teams
// and a mode, as `GET /orgs/{org}` answers them, and chat run from its package.
const PKG = "com.calimero.chat";

const h = await vi.hoisted(async () => {
  type Team = {
    members: Record<string, boolean>;
    join: "everyone" | "invite";
    removed: string[];
    parent: string | null;
    metadata: unknown;
  };
  type Org = {
    orgId: string;
    name: string;
    members: Record<string, string>;
    memberMetadata: Record<string, unknown>;
    defaultCapabilities: number;
    capabilities: Record<string, number>;
    metadata: unknown;
    teams: Record<string, Team>;
    mode: "legacy" | "standalone" | "shared";
  };
  const state = {
    orgs: new Map<string, Org>(),
    apps: new Map<string, Record<string, unknown>>(),
    seq: 0,
    me: "acct-me",
    scopeFails: false,
  };
  const modeOf = (o: Org) => {
    const apps = Object.values(o.teams).filter((t) => !t.parent && t.metadata);
    if (apps.length === 0) return "legacy" as const;
    return apps.some((t) => t.join === "invite") ? ("shared" as const) : ("standalone" as const);
  };
  const client = (await import("@calimero-apps/connect/testing")).withRoutes({
    me: vi.fn(async () => ({
      orgs: [...state.orgs.values()].map((o) => ({ orgId: o.orgId, name: o.name, role: o.members[state.me] })),
    })),
    // As core answers it: a closed team only for its members and the org's admins.
    getOrg: vi.fn(async (org: string) => {
      const o = state.orgs.get(org);
      if (!o) throw Object.assign(new Error("404"), { status: 404 });
      const role = o.members[state.me];
      const admin = role === "owner" || role === "admin";
      const teams = Object.fromEntries(
        Object.entries(o.teams).filter(([, t]) => admin || t.join === "everyone" || state.me in t.members),
      );
      return structuredClone({ ...o, teams, mode: modeOf(o) });
    }),
    getApp: vi.fn(async (app: string) => {
      const a = state.apps.get(app);
      if (!a) throw Object.assign(new Error("404"), { status: 404 });
      return a;
    }),
    listApps: vi.fn(async (filter: { bundle?: string; package?: string } = {}) =>
      [...state.apps.values()]
        .map((a) => ({
          appId: a.appId as string,
          name: a.name as string,
          owner: a.owner as string,
          org: a.org as string | null,
          bundle: "bundle-hash",
          package: PKG,
          version: null,
        }))
        .filter((a) => !filter.package || a.package === filter.package),
    ),
    createOrg: vi.fn(async (name: string) => {
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
        mode: "legacy",
      });
      return orgId;
    }),
    setCapabilities: vi.fn(async () => {}),
    setOrgMetadata: vi.fn(async () => {}),
    createApp: vi.fn(async (name: string, _source: unknown, options: { org: string; access: unknown }) => {
      const appId = `app-${(state.seq += 1)}`;
      state.apps.set(appId, { appId, name, owner: state.me, org: options.org, access: options.access, metadata: null });
      return appId;
    }),
    setAccess: vi.fn(async (app: string, access: unknown) => {
      state.apps.get(app)!.access = access;
    }),
    session: { accountId: "acct-me" },
    // core's ScopeApps for chat: find or make its team, move org-access chat instances onto it.
    scopeApps: vi.fn(
      async (org: string, _passkey: unknown, body: { apps: Array<{ package: string }>; shared?: boolean }) => {
        if (state.scopeFails) throw Object.assign(new Error("declined"), { status: 412 });
        const o = state.orgs.get(org)!;
        let teamId = Object.keys(o.teams).find(
          (id) => (o.teams[id]!.metadata as { app?: { package?: string } } | null)?.app?.package === PKG,
        );
        const created = !teamId;
        if (!teamId) {
          teamId = "team-chat";
          o.teams[teamId] = { members: { [state.me]: true }, join: "everyone", removed: [], parent: null, metadata: { app: { package: body.apps[0]!.package } } };
        }
        const moved: string[] = [];
        for (const a of state.apps.values()) {
          if (a.org === org && (a.access as { kind: string }).kind === "org") {
            a.access = { kind: "team", team: teamId };
            moved.push(a.appId as string);
          }
        }
        if (body.shared) for (const t of Object.values(o.teams)) if (!t.parent && t.metadata) t.join = "invite";
        return { mode: modeOf(o), teams: [{ package: PKG, teamId, created, apps: moved, added: 0 }] };
      },
    ),
    listAppTeams: vi.fn(async (org: string) => {
      const o = state.orgs.get(org)!;
      return {
        mode: modeOf(o),
        appTeams: Object.entries(o.teams)
          .filter(([, t]) => !t.parent && t.metadata)
          .map(([teamId, t]) => ({
            package: (t.metadata as { app: { package: string } }).app.package,
            teamId,
            name: "Chat",
            join: t.join,
            memberCount: Object.keys(t.members).length,
            defaultCapabilities: null,
            member: state.me in t.members || t.join === "everyone",
            manages: true,
          })),
      };
    }),
    invite: vi.fn(async () => "tok-1"),
    setTeamMember: vi.fn(async (org: string, team: string, account: string) => {
      state.orgs.get(org)!.teams[team]!.members[account] = false;
    }),
    removeTeamMember: vi.fn(async (org: string, team: string, account: string) => {
      delete state.orgs.get(org)!.teams[team]!.members[account];
    }),
    setMemberMetadata: vi.fn(async () => {}),
    setMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => ({})),
    deleteOrg: vi.fn(async () => {}),
    deleteApp: vi.fn(async () => {}),
  });
  return { state, client };
});

vi.mock("../calimero", () => ({
  after: () => {},
  getClient: () => h.client,
  getAccountId: () => h.state.me,
  chatSource: () => ({ package: "com.calimero.chat" }),
  passkey: () => ({ create: vi.fn(), get: vi.fn() }),
}));

import { chatPackage, invalidate, visibilityOf } from "../platform";
import { GroupApiDataSource } from "./groupApiDataSource";
import { createChannel } from "../../utils/createChannel";

const api = new GroupApiDataSource();

/** A workspace made in Chat, with #general, and more people in its org. */
async function workspace(people: Record<string, string> = {}): Promise<{ org: string; general: string }> {
  const { data } = await api.createGroup({ applicationId: "x", name: "Acme" });
  const org = data!.groupId;
  const made = await createChannel(org, "general", true);
  if ("error" in made) throw new Error(made.error);
  Object.assign(h.state.orgs.get(org)!.members, people);
  invalidate();
  return { org, general: made.contextId };
}

/** An org made elsewhere: legacy (no app teams), or holding another app's team. */
function otherOrg(mode: "legacy" | "standalone" | "shared", role = "owner"): string {
  const orgId = `org-x${(h.state.seq += 1)}`;
  const teams: Record<string, { members: Record<string, boolean>; join: "everyone" | "invite"; removed: string[]; parent: null; metadata: unknown }> = {};
  if (mode !== "legacy") {
    teams["team-blocks"] = {
      members: {},
      join: mode === "shared" ? "invite" : "everyone",
      removed: [],
      parent: null,
      metadata: { app: { package: "com.calimero.mero-blocks" } },
    };
  }
  h.state.orgs.set(orgId, {
    orgId,
    name: "Elsewhere",
    members: { [h.state.me]: role, "acct-ana": "owner" },
    memberMetadata: {},
    defaultCapabilities: 4 | 1,
    capabilities: {},
    metadata: null,
    teams,
    mode,
  });
  return orgId;
}

const accessOf = (app: string) => h.state.apps.get(app)!.access as { kind: string; team?: string; accounts?: string[] };

beforeEach(() => {
  h.state.orgs.clear();
  h.state.apps.clear();
  h.state.seq = 0;
  h.state.me = "acct-me";
  h.state.scopeFails = false;
  h.client.session.accountId = "acct-me";
  invalidate();
  vi.clearAllMocks();
});

describe("a new workspace gets chat's own app team", () => {
  it("runs from chat's package", () => {
    expect(chatPackage()).toBe(PKG);
  });

  it("is made open (standalone), and #general is on it", async () => {
    const { org, general } = await workspace();
    expect(h.client.scopeApps).toHaveBeenCalledWith(org, expect.anything(), { apps: [{ package: PKG }], shared: false });
    expect(h.state.orgs.get(org)!.teams["team-chat"]!.join).toBe("everyone");
    expect(accessOf(general)).toEqual({ kind: "team", team: "team-chat" });
  });

  it("a channel on the app team reads as open", async () => {
    const { general } = await workspace();
    const vis = await api.getContextVisibility("", general);
    expect(vis.data?.mode).toBe("open");
    expect(visibilityOf({ kind: "team", team: "t" })).toBe("open");
  });

  it("made private and open again, it goes back onto the app team", async () => {
    const { org, general } = await workspace();
    await api.setContextVisibility(org, general, { mode: "restricted" });
    expect(accessOf(general)).toEqual({ kind: "accounts", accounts: [] });
    await api.setContextVisibility(org, general, { mode: "open" });
    expect(accessOf(general)).toEqual({ kind: "team", team: "team-chat" });
  });

  it("a passkey declined for the team: the workspace stays, a legacy one", async () => {
    h.state.scopeFails = true;
    const { org, general } = await workspace();
    expect(h.state.orgs.get(org)!.teams).toEqual({});
    expect(accessOf(general)).toEqual({ kind: "org" });
  });
});

describe("invites name chat's app team", () => {
  it("standalone: the team is named, and the link is the workspace's", async () => {
    const { org } = await workspace();
    const res = await api.createInvitation(org);
    expect(h.client.invite).toHaveBeenCalledWith(org, "member", expect.anything(), ["team-chat"]);
    expect(res.data).toEqual({ invitation: "tok-1", groupAlias: "Acme" });
  });

  it("shared: the same call, and the link says it gives Chat only", async () => {
    const { org } = await workspace();
    h.state.orgs.get(org)!.teams["team-chat"]!.join = "invite";
    invalidate();
    const res = await api.createInvitation(org);
    expect(h.client.invite).toHaveBeenCalledWith(org, "member", expect.anything(), ["team-chat"]);
    expect(res.data).toMatchObject({ invitation: "tok-1", chatOnly: true });
  });

  it("a legacy org: the org-wide invite, as before", async () => {
    const org = otherOrg("legacy");
    const res = await api.createInvitation(org);
    expect(h.client.invite).toHaveBeenCalledWith(org, "member", expect.anything());
    expect(res.data?.chatOnly).toBeUndefined();
  });
});

describe("the workspace's people are Chat's", () => {
  const people = { "acct-bob": "member", "acct-cy": "member", "acct-gus": "guest" };

  it("standalone (an open team): every member, not a guest without a row", async () => {
    const { org, general } = await workspace(people);
    const members = (await api.listMembers(org)).data!.members.map((m) => m.identity);
    expect(members).toEqual(["acct-me", "acct-bob", "acct-cy"]);
    const channel = (await api.listMembers(general)).data!.members.map((m) => m.identity);
    expect(channel).toEqual(["acct-me", "acct-bob", "acct-cy"]);
    expect((await api.getGroup(org)).data?.memberCount).toBe(3);
  });

  it("shared (a closed team): only the people in Chat, for the workspace and its open channels", async () => {
    const { org, general } = await workspace(people);
    const team = h.state.orgs.get(org)!.teams["team-chat"]!;
    team.join = "invite";
    team.members["acct-bob"] = false;
    invalidate();
    expect((await api.listMembers(org)).data!.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    expect((await api.listMembers(general)).data!.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    expect((await api.getGroup(general)).data?.subgroupVisibility).toBe("open");
  });

  it("shared: someone taken out of Chat sees nobody in it, themselves included", async () => {
    const { org } = await workspace(people);
    const team = h.state.orgs.get(org)!.teams["team-chat"]!;
    team.join = "invite";
    team.members["acct-bob"] = false;
    h.state.me = "acct-bob";
    invalidate();
    expect((await api.listMembers(org)).data!.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    // Calimero Home sets Bob to No for Chat: core no longer shows him its team.
    delete team.members["acct-bob"];
    invalidate();
    expect((await api.listMembers(org)).data!.members).toEqual([]);
    expect((await api.getGroup(org)).data?.memberCount).toBe(0);
  });

  it("someone in the org but not in Chat is added to the app team, not the org", async () => {
    const { org } = await workspace(people);
    h.state.orgs.get(org)!.teams["team-chat"]!.join = "invite";
    invalidate();
    await api.addGroupMember(org, "acct-cy");
    expect(h.client.setTeamMember).toHaveBeenCalledWith(org, "team-chat", "acct-cy", expect.anything());
    expect(h.client.setMember).not.toHaveBeenCalled();
  });

  it("a legacy org: every org member, the guest too", async () => {
    const org = otherOrg("legacy");
    Object.assign(h.state.orgs.get(org)!.members, people);
    const members = (await api.listMembers(org)).data!.members.map((m) => m.identity);
    expect(members).toEqual(["acct-me", "acct-ana", "acct-bob", "acct-cy", "acct-gus"]);
  });
});

describe("removing someone", () => {
  it("shared: out of Chat (its team and the private channels listing them), never out of the org", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    const team = h.state.orgs.get(org)!.teams["team-chat"]!;
    team.join = "invite";
    team.members["acct-bob"] = false;
    const secret = await createChannel(org, "secret", false);
    if ("error" in secret) throw new Error(secret.error);
    h.state.apps.get(secret.contextId)!.access = { kind: "accounts", accounts: ["acct-bob"] };
    invalidate();

    expect((await api.removeMember(org, "acct-bob")).error).toBeNull();
    expect(h.client.removeTeamMember).toHaveBeenCalledWith(org, "team-chat", "acct-bob", expect.anything());
    expect(h.client.removeMember).not.toHaveBeenCalled();
    expect(accessOf(secret.contextId)).toEqual({ kind: "accounts", accounts: [] });
  });

  it("standalone: out of the organization, as before (the org is Chat's)", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    await api.removeMember(org, "acct-bob");
    expect(h.client.removeMember).toHaveBeenCalledWith(org, "acct-bob", expect.anything());
    expect(h.client.removeTeamMember).not.toHaveBeenCalled();
  });
});

describe("leaving", () => {
  it("shared: Chat's team only, never the org; lastApp when it was the person's last app there", async () => {
    const { org } = await workspace({ "acct-ana": "owner" });
    const team = h.state.orgs.get(org)!.teams["team-chat"]!;
    team.join = "invite";
    team.members["acct-me"] = false;
    h.state.orgs.get(org)!.members["acct-me"] = "member";
    invalidate();

    const res = await api.leaveNamespace(org);
    expect(res.data).toMatchObject({ left: "app", lastApp: true });
    expect(h.client.removeTeamMember).toHaveBeenCalledWith(org, "team-chat", "acct-me", expect.anything());
    expect(h.client.removeMember).not.toHaveBeenCalled();

    expect((await api.leaveOrganization(org)).error).toBeNull();
    expect(h.client.removeMember).toHaveBeenCalledWith(org, "acct-me", expect.anything());
  });

  it("standalone: leaving is leaving the organization, as before", async () => {
    const { org } = await workspace({ "acct-ana": "owner" });
    const res = await api.leaveNamespace(org);
    expect(res.data).toMatchObject({ left: "org", lastApp: false });
    expect(h.client.removeMember).toHaveBeenCalledWith(org, "acct-me", expect.anything());
    expect(h.client.removeTeamMember).not.toHaveBeenCalled();
  });

  it("a legacy org: leaving is leaving the organization", async () => {
    const org = otherOrg("legacy", "member");
    expect((await api.leaveNamespace(org)).data).toMatchObject({ left: "org" });
    expect(h.client.removeMember).toHaveBeenCalledWith(org, "acct-me", expect.anything());
  });
});

describe("connecting chat to an organization made for another app", () => {
  it("a legacy org keeps organization access: nothing is converted from here", async () => {
    const org = otherOrg("legacy");
    const made = await createChannel(org, "general", true);
    if ("error" in made) throw new Error(made.error);
    expect(h.client.scopeApps).not.toHaveBeenCalled();
    expect(accessOf(made.contextId)).toEqual({ kind: "org" });
  });

  it("an admin of a standalone org: chat's team is made open, the other app's left open", async () => {
    const org = otherOrg("standalone", "admin");
    const made = await createChannel(org, "general", true);
    if ("error" in made) throw new Error(made.error);
    expect(h.client.scopeApps).toHaveBeenCalledWith(org, expect.anything(), { apps: [{ package: PKG }], shared: false });
    expect(h.state.orgs.get(org)!.teams["team-blocks"]!.join).toBe("everyone");
    expect(accessOf(made.contextId)).toEqual({ kind: "team", team: "team-chat" });
  });

  it("an admin of a shared org: chat's team is closed like the others", async () => {
    const org = otherOrg("shared", "admin");
    const made = await createChannel(org, "general", true);
    if ("error" in made) throw new Error(made.error);
    expect(h.client.scopeApps).toHaveBeenCalledWith(org, expect.anything(), { apps: [{ package: PKG }], shared: true });
    expect(h.state.orgs.get(org)!.teams["team-chat"]!.join).toBe("invite");
  });

  it("a member of an org with app teams cannot add Chat: told so, nothing made", async () => {
    const org = otherOrg("standalone", "member");
    const made = await createChannel(org, "general", true);
    expect(made).toEqual({ error: expect.stringMatching(/owners and admins can add Hyperfeed Chat/) });
    expect(h.client.scopeApps).not.toHaveBeenCalled();
    expect(h.client.createApp).not.toHaveBeenCalled();
  });
});
