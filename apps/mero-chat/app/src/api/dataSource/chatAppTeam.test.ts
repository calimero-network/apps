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
    // As core: off a team and every team below it.
    removeTeamMember: vi.fn(async (org: string, team: string, account: string) => {
      const o = state.orgs.get(org)!;
      for (const [id, t] of Object.entries(o.teams)) {
        if (id === team || t.parent === team) delete t.members[account];
      }
    }),
    // A channel's team: its creator leads it.
    createTeam: vi.fn(async (org: string, _name: string, join: "everyone" | "invite", parent?: string) => {
      const teamId = `team-${(state.seq += 1)}`;
      state.orgs.get(org)!.teams[teamId] = { members: { [state.me]: true }, join, removed: [], parent: parent ?? null, metadata: null };
      return teamId;
    }),
    updateTeam: vi.fn(async (org: string, team: string, update: { join?: "everyone" | "invite" }) => {
      if (update.join) state.orgs.get(org)!.teams[team]!.join = update.join;
    }),
    // As core: the team goes, and the instances on it.
    deleteTeam: vi.fn(async (org: string, team: string) => {
      delete state.orgs.get(org)!.teams[team];
      for (const [id, a] of state.apps) if ((a.access as { team?: string }).team === team) state.apps.delete(id);
      return { teams: [team], apps: [] };
    }),
    getTeam: vi.fn(async (_org: string, team: string) => ({
      teamId: team,
      apps: [...state.apps.values()]
        .filter((a) => (a.access as { team?: string }).team === team)
        .map((a) => ({ appId: a.appId, name: a.name })),
    })),
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

import { chatPackage, invalidate, MANAGED_IN_HOME, NO_CHAT_TEAM, resetBoundSession, visibilityOf } from "../platform";
import { GroupApiDataSource } from "./groupApiDataSource";
import { ContextApiDataSource } from "./nodeApiDataSource";
import { createChannel } from "../../utils/createChannel";
import { createDmContextInGroup } from "../../utils/dmContext";

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

  it("is made open (standalone), and #general is an open team below it", async () => {
    const { org, general } = await workspace();
    expect(h.client.scopeApps).toHaveBeenCalledWith(org, expect.anything(), { apps: [{ package: PKG }], shared: false });
    const o = h.state.orgs.get(org)!;
    expect(o.teams["team-chat"]!.join).toBe("everyone");
    const team = accessOf(general).team!;
    expect(team).not.toBe("team-chat");
    expect(o.teams[team]).toMatchObject({ parent: "team-chat", join: "everyone", members: { "acct-me": true } });
    expect((await api.getContextVisibility("", general)).data?.mode).toBe("open");
  });

  it("made private and open again: its team's join, the instance stays on it", async () => {
    const { org, general } = await workspace();
    const team = accessOf(general).team!;
    await api.setContextVisibility(org, general, { mode: "restricted" });
    expect(h.client.updateTeam).toHaveBeenLastCalledWith(org, team, { join: "invite" });
    expect(h.state.orgs.get(org)!.teams[team]!.join).toBe("invite");
    expect((await api.getContextVisibility("", general)).data?.mode).toBe("restricted");
    await api.setContextVisibility(org, general, { mode: "open" });
    expect(h.state.orgs.get(org)!.teams[team]!.join).toBe("everyone");
    expect(accessOf(general)).toEqual({ kind: "team", team });
    expect(h.client.setAccess).not.toHaveBeenCalled();
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
    // #general is open below Chat's team: Chat's people, not the org's.
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
  it("shared: out of Chat's team (core drops their channel rows with it), never out of the org", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    const team = h.state.orgs.get(org)!.teams["team-chat"]!;
    team.join = "invite";
    team.members["acct-bob"] = false;
    const secret = await createChannel(org, "secret", false);
    if ("error" in secret) throw new Error(secret.error);
    await api.addGroupMember(secret.contextId, "acct-bob");
    invalidate();

    expect((await api.removeMember(org, "acct-bob")).error).toBeNull();
    expect(h.client.removeTeamMember).toHaveBeenCalledTimes(1);
    expect(h.client.removeTeamMember).toHaveBeenCalledWith(org, "team-chat", "acct-bob", expect.anything());
    expect(h.client.removeMember).not.toHaveBeenCalled();
    expect(h.state.orgs.get(org)!.teams[accessOf(secret.contextId).team!]!.members).toEqual({ "acct-me": true });
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
    const team = accessOf(made.contextId).team!;
    expect(h.state.orgs.get(org)!.teams[team]).toMatchObject({ parent: "team-chat", join: "everyone" });
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
    expect(made).toEqual({ error: expect.stringMatching(/owners and admins can add Mero Chat/) });
    expect(h.client.scopeApps).not.toHaveBeenCalled();
    expect(h.client.createApp).not.toHaveBeenCalled();
    expect(h.client.createTeam).not.toHaveBeenCalled();
  });
});

describe("on Chat's own page, a workspace without Chat's team", () => {
  it("is not given one from here: an admin adds it in Home, nothing made", async () => {
    const org = otherOrg("standalone", "admin");
    h.client.me.mockResolvedValueOnce({ orgs: [], app: PKG } as { orgs: [] });
    resetBoundSession();
    try {
      const made = await createChannel(org, "general", true);
      expect(made).toEqual({ error: NO_CHAT_TEAM });
      expect(h.client.scopeApps).not.toHaveBeenCalled();
      expect(h.client.createTeam).not.toHaveBeenCalled();
      expect(h.client.createApp).not.toHaveBeenCalled();
    } finally {
      resetBoundSession();
    }
  });
});

describe("channels and DMs are teams below Chat's", () => {
  const confirm = { confirm: expect.anything() };

  it("a private channel: a closed team with its creator and the people added, then its instance on it", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    const sg = (await api.createSubgroup(org, { groupName: "secret", visibility: "restricted" })).data!.groupId;
    await api.addGroupMember(sg, "acct-bob");
    const made = await createChannel(org, "secret", false, {
      createSubgroup: async () => ({ data: { groupId: sg }, error: null }),
      setSubgroupVisibility: (...a) => api.setSubgroupVisibility(...a),
      createGroupContext: (...a) => new ContextApiDataSource().createGroupContext(...a),
      joinChat: async () => ({ data: "ok", error: null }),
    });
    if ("error" in made) throw new Error(made.error);
    const team = accessOf(made.contextId).team!;
    expect(h.client.createTeam).toHaveBeenLastCalledWith(org, "secret", "invite", "team-chat");
    expect(h.client.setTeamMember).toHaveBeenCalledWith(org, team, "acct-bob", confirm, { lead: false });
    expect(h.state.orgs.get(org)!.teams[team]).toMatchObject({ join: "invite", members: { "acct-me": true, "acct-bob": false } });
    expect((await api.getContextVisibility(org, made.contextId)).data?.mode).toBe("restricted");
    expect((await api.listMembers(made.contextId)).data!.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    expect((await api.getContextAllowlist(org, made.contextId)).data).toEqual(["acct-me", "acct-bob"]);
  });

  it("a DM: a closed team of two named by its alias, nobody's name on it", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    const ctx = await createDmContextInGroup({
      groupId: org,
      applicationId: "x",
      myIdentity: "acct-me",
      otherIdentity: "acct-bob",
      groupApi: api,
      contextApi: new ContextApiDataSource(),
    });
    const id = ctx.data!.contextId;
    const team = accessOf(id).team!;
    expect(h.client.createTeam).toHaveBeenLastCalledWith(org, ctx.alias, "invite", "team-chat");
    expect(h.state.orgs.get(org)!.teams[team]).toMatchObject({
      parent: "team-chat",
      join: "invite",
      members: { "acct-me": true, "acct-bob": false },
      metadata: null,
    });
    expect(h.client.updateTeam).not.toHaveBeenCalledWith(org, team, expect.objectContaining({ metadata: expect.anything() }));
  });

  it("adds an existing workspace member to a channel and removes them: rows on its team", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    const secret = await createChannel(org, "secret", false);
    if ("error" in secret) throw new Error(secret.error);
    const team = accessOf(secret.contextId).team!;

    expect((await api.addGroupMember(secret.contextId, "acct-bob")).error).toBeNull();
    expect(h.client.setTeamMember).toHaveBeenCalledWith(org, team, "acct-bob", confirm, { lead: false });
    expect(h.client.invite).not.toHaveBeenCalled();
    expect(h.client.setMember).not.toHaveBeenCalled();

    expect((await api.removeMember(secret.contextId, "acct-bob")).error).toBeNull();
    expect(h.client.removeTeamMember).toHaveBeenCalledWith(org, team, "acct-bob", confirm);
    expect(h.state.orgs.get(org)!.teams[team]!.members).toEqual({ "acct-me": true });
  });

  it("a member makes a channel closed, then opens it as its lead", async () => {
    const { org } = await workspace({ "acct-bob": "member" });
    h.state.me = "acct-bob";
    h.client.session.accountId = "acct-bob";
    invalidate();
    const made = await createChannel(org, "random", true);
    if ("error" in made) throw new Error(made.error);
    const team = accessOf(made.contextId).team!;
    expect(h.client.createTeam).toHaveBeenLastCalledWith(org, "random", "invite", "team-chat");
    expect(h.client.updateTeam).toHaveBeenLastCalledWith(org, team, { join: "everyone" });
    expect(h.state.orgs.get(org)!.teams[team]).toMatchObject({ join: "everyone", members: { "acct-bob": true } });
  });

  it("renames a channel: its team and its instance", async () => {
    const { org, general } = await workspace();
    await api.setContextAlias(org, general, "lobby");
    expect(h.client.updateTeam).toHaveBeenLastCalledWith(org, accessOf(general).team, { name: "lobby" });
  });

  it("deletes a channel through its team (a passkey step-up), never the app itself", async () => {
    const { org, general } = await workspace();
    const team = accessOf(general).team!;
    expect((await api.deleteGroup(general)).error).toBeNull();
    expect(h.client.deleteTeam).toHaveBeenCalledWith(org, team, confirm);
    expect(h.client.deleteApp).not.toHaveBeenCalled();
    expect(h.state.apps.has(general)).toBe(false);

    const other = await createChannel(org, "other", true);
    if ("error" in other) throw new Error(other.error);
    const otherTeam = accessOf(other.contextId).team!;
    expect((await new ContextApiDataSource().deleteContext({ contextId: other.contextId })).error).toBeNull();
    expect(h.client.deleteTeam).toHaveBeenLastCalledWith(org, otherTeam, confirm);
    expect(h.client.deleteApp).not.toHaveBeenCalled();
  });

  it("lists the channel teams the person is in, then those made before channels had teams", async () => {
    const { org, general } = await workspace({ "acct-bob": "member" });
    const secret = await createChannel(org, "secret", false);
    if ("error" in secret) throw new Error(secret.error);
    h.state.apps.set("app-old", { appId: "app-old", name: "old", owner: "acct-me", org, access: { kind: "accounts", accounts: ["acct-bob"] }, metadata: null });
    invalidate();
    const ids = (await api.listSubgroups(org)).data!.map((s) => s.groupId);
    expect(ids).toEqual([general, secret.contextId, "app-old"]);
    expect(h.client.getTeam).toHaveBeenCalledTimes(2);

    // Bob is in #general (open) but has no row on #secret.
    h.state.me = "acct-bob";
    h.state.apps.delete(secret.contextId);
    invalidate();
    expect((await api.listSubgroups(org)).data!.map((s) => s.groupId)).toEqual([general, "app-old"]);
  });

  it("a channel made before channels had teams opens as before; its member controls point to Calimero Home", async () => {
    const { org, general } = await workspace({ "acct-bob": "member" });
    h.state.apps.set("app-old", { appId: "app-old", name: "old", owner: "acct-me", org, access: { kind: "accounts", accounts: ["acct-bob"] }, metadata: null });
    h.state.apps.get(general)!.access = { kind: "team", team: "team-chat" };
    invalidate();

    expect((await api.listMembers("app-old")).data!.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    expect((await api.getContextVisibility(org, "app-old")).data?.mode).toBe("restricted");
    expect((await api.getContextVisibility(org, general)).data?.mode).toBe("open");
    expect(visibilityOf({ kind: "team", team: "t" })).toBe("open");
    expect(await api.channelManagedInHome("app-old")).toBe(true);
    expect(await api.channelManagedInHome(general)).toBe(true);

    for (const res of [
      await api.addGroupMember("app-old", "acct-cy"),
      await api.removeMember("app-old", "acct-bob"),
      await api.setContextVisibility(org, "app-old", { mode: "open" }),
      await api.setSubgroupVisibility(general, { subgroupVisibility: "restricted" }),
    ]) {
      expect(res.error?.message).toBe(MANAGED_IN_HOME);
    }
    expect(h.client.setAccess).not.toHaveBeenCalled();
    expect(h.client.setTeamMember).not.toHaveBeenCalled();
  });
});
