import { beforeEach, describe, expect, it, vi } from "vitest";

// A Calimero 1.0 cluster in memory: one org, the chat instances in it.
const h = await vi.hoisted(async () => {
  const state = {
    orgs: new Map<string, Record<string, unknown>>(),
    apps: new Map<string, Record<string, unknown>>(),
    seq: 0,
  };
  const client = (await import("@calimero-apps/connect/testing")).withRoutes({
    me: vi.fn(async () => ({
      orgs: [...state.orgs.values()].map((o) => ({ orgId: o.orgId, name: o.name, role: (o.members as Record<string, string>)["acct-me"] })),
    })),
    getOrg: vi.fn(async (org: string) => {
      const o = state.orgs.get(org);
      if (!o) throw Object.assign(new Error("404"), { status: 404 });
      return o;
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
          bundle: (a.bundle as string | undefined) ?? "bundle-hash",
          package: (a.package as string | undefined) ?? null,
          version: null,
        }))
        .filter((a) => (!filter.bundle || a.bundle === filter.bundle) && (!filter.package || a.package === filter.package)),
    ),
    createOrg: vi.fn(async (name: string) => {
      const orgId = `org-${(state.seq += 1)}`;
      state.orgs.set(orgId, { orgId, name, members: { "acct-me": "owner" }, memberMetadata: {}, defaultCapabilities: 4, capabilities: {}, metadata: null });
      return orgId;
    }),
    setCapabilities: vi.fn(async () => {}),
    createApp: vi.fn(async (name: string, _source: unknown, options: { org: string; access: unknown; initArgs: unknown }) => {
      const appId = `app-${(state.seq += 1)}`;
      state.apps.set(appId, { appId, name, owner: "acct-me", org: options.org, access: options.access, metadata: null, initArgs: options.initArgs });
      return appId;
    }),
    setAccess: vi.fn(async (app: string, access: unknown) => {
      const a = state.apps.get(app)!;
      a.access = access;
    }),
    session: { accountId: "acct-me" },
    setMemberMetadata: vi.fn(async () => {}),
    setMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => ({})),
    deleteOrg: vi.fn(async () => {}),
    deleteApp: vi.fn(async () => {}),
    // Teams, as core keeps them: a channel's, its creator leading it.
    createTeam: vi.fn(async (org: string, name: string, join: string, parent?: string) => {
      const o = state.orgs.get(org)!;
      const teams = (o.teams ??= {}) as Record<string, Record<string, unknown>>;
      const teamId = `team-${(state.seq += 1)}`;
      teams[teamId] = { name, join, parent: parent ?? null, members: { "acct-me": true }, removed: [] };
      return teamId;
    }),
    updateTeam: vi.fn(async (org: string, team: string, update: Record<string, unknown>) => {
      Object.assign((state.orgs.get(org)!.teams as Record<string, object>)[team]!, update);
    }),
    setTeamMember: vi.fn(async (org: string, team: string, account: string) => {
      ((state.orgs.get(org)!.teams as Record<string, { members: Record<string, boolean> }>)[team]!.members)[account] = false;
    }),
    removeTeamMember: vi.fn(async (org: string, team: string, account: string) => {
      delete (state.orgs.get(org)!.teams as Record<string, { members: Record<string, boolean> }>)[team]!.members[account];
    }),
    deleteTeam: vi.fn(async (org: string, team: string) => {
      delete (state.orgs.get(org)!.teams as Record<string, object>)[team];
      for (const [id, a] of state.apps) if ((a.access as { team?: string }).team === team) state.apps.delete(id);
      return { teams: [team], apps: [] };
    }),
  });
  return { state, client };
});

vi.mock("../calimero", () => ({
  after: () => {},
  getClient: () => h.client,
  getAccountId: () => "acct-me",
  chatSource: () => "bundle-hash",
  passkey: () => ({ create: vi.fn(), get: vi.fn() }),
}));

import { getOrgRecord, invalidate, memberAvatar, memberName, setMemberAvatar } from "../platform";
import { GroupApiDataSource } from "./groupApiDataSource";
import { ContextApiDataSource } from "./nodeApiDataSource";
import { createChannel } from "../../utils/createChannel";
import { CAN_CREATE_CONTEXT, CAN_CREATE_SUBGROUP, CAN_INVITE_MEMBERS } from "../../utils/groupCapabilities";

const ORG_CREATE_TEAM = 1 << 5;

const api = new GroupApiDataSource();

beforeEach(() => {
  h.state.orgs.clear();
  h.state.apps.clear();
  h.state.seq = 0;
  invalidate();
  vi.clearAllMocks();
});

describe("a workspace is an org", () => {
  it("is created without setting org-wide capabilities", async () => {
    const res = await api.createGroup({ applicationId: "x", name: "Team" });
    expect(res.data).toEqual({ groupId: "org-1" });
    expect(h.client.setCapabilities).not.toHaveBeenCalled();
  });

  // A dev bundle has no app team: roles and capabilities stay org-wide there.
  it("without chat's app team, roles and capabilities stay on the org", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    const org = h.state.orgs.get("org-1")!;
    org.members = { "acct-me": "owner", "acct-bob": "member" };
    // CREATE_APP alone does not make a channel there: a channel is a team at the top.
    org.capabilities = { "acct-bob": CAN_CREATE_CONTEXT };
    invalidate();
    expect((await api.getMemberCapabilities("org-1", "acct-bob")).data?.capabilities).toBe(0);
    org.capabilities = { "acct-bob": CAN_CREATE_CONTEXT | ORG_CREATE_TEAM };
    invalidate();
    expect((await api.getMemberCapabilities("org-1", "acct-bob")).data?.capabilities).toBe(
      CAN_CREATE_CONTEXT | ORG_CREATE_TEAM | CAN_CREATE_SUBGROUP,
    );
    // "Create channels" grants both; turned off, it takes both.
    await api.setMemberCapabilities("org-1", "acct-bob", { capabilities: CAN_CREATE_CONTEXT | CAN_CREATE_SUBGROUP });
    expect(h.client.setCapabilities).toHaveBeenLastCalledWith("org-1", CAN_CREATE_CONTEXT | ORG_CREATE_TEAM, expect.anything(), {
      account: "acct-bob",
    });
    await api.setMemberCapabilities("org-1", "acct-bob", { capabilities: CAN_INVITE_MEMBERS });
    expect(h.client.setCapabilities).toHaveBeenLastCalledWith("org-1", CAN_INVITE_MEMBERS, expect.anything(), {
      account: "acct-bob",
    });
    await api.updateMemberRole("org-1", "acct-bob", "Admin");
    expect(h.client.setMember).toHaveBeenCalledWith("org-1", "acct-bob", "admin", expect.anything());
  });

  it("lists the orgs the account is in that hold chat", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    await createChannel("org-1", "general", true);
    const res = await api.listGroups();
    expect(res.data).toEqual([expect.objectContaining({ groupId: "org-1", alias: "Team" })]);
  });

  it("maps org roles to v1 member roles and names from member metadata", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    const org = h.state.orgs.get("org-1")!;
    org.members = { "acct-me": "owner", "acct-bob": "member", "acct-gus": "guest" };
    org.memberMetadata = { "acct-bob": { name: "Bob" } };
    invalidate();
    const res = await api.listMembers("org-1");
    expect(res.data?.members).toEqual([
      { identity: "acct-me", role: "Admin", alias: undefined, orgAdmin: true, orgRole: "owner" },
      { identity: "acct-bob", role: "Member", alias: "Bob", orgRole: "member" },
      { identity: "acct-gus", role: "ReadOnly", alias: undefined, orgRole: "guest" },
    ]);
    expect(res.data?.selfIdentity).toBe("acct-me");
  });

});

describe("a channel is a chat instance in the org", () => {
  it("is created from v1's steps: subgroup, visibility, members, then context", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    const sg = await api.createSubgroup("org-1", { groupName: "secret", visibility: "restricted" });
    const pending = sg.data!.groupId;
    await api.setSubgroupVisibility(pending, { subgroupVisibility: "restricted" });
    await api.addGroupMember(pending, "acct-bob");
    const ctx = await new ContextApiDataSource().createGroupContext({
      applicationId: "x",
      groupId: pending,
      name: "secret",
      initializationParams: { name: "secret", context_type: "Channel", description: "", created_at: 1, creator_username: "me" },
    });
    expect(ctx.data).toEqual({ contextId: "app-3", memberPublicKey: "acct-me" });
    // A dev bundle has no app team: the channel's team is at the top of the org.
    expect(h.client.createTeam).toHaveBeenCalledWith("org-1", "secret", "invite");
    expect(h.client.setTeamMember).toHaveBeenCalledWith("org-1", "team-2", "acct-bob", expect.anything(), { lead: false });
    expect(h.client.createApp).toHaveBeenCalledWith("secret", "bundle-hash", {
      org: "org-1",
      access: { kind: "team", team: "team-2" },
      initArgs: { name: "secret", contextType: "Channel", description: "", creatorUsername: "me" },
    });
  });

  it("an open channel reaches every org member; made private, the people with a row on its team", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    h.state.orgs.get("org-1")!.members = { "acct-me": "owner", "acct-bob": "member" };
    invalidate();
    const general = await createChannel("org-1", "general", true, {
      createSubgroup: (...a) => api.createSubgroup(...a),
      setSubgroupVisibility: (...a) => api.setSubgroupVisibility(...a),
      createGroupContext: (...a) => new ContextApiDataSource().createGroupContext(...a),
    });
    const id = (general as { contextId: string }).contextId;
    expect(h.state.apps.get(id)!.access).toEqual({ kind: "team", team: "team-2" });

    const info = await api.getGroup(id);
    expect(info.data).toMatchObject({ subgroupVisibility: "open", memberCount: 2, alias: "general" });
    const subgroups = await api.listSubgroups("org-1");
    expect(subgroups.data).toEqual([{ groupId: id, alias: "general" }]);
    const contexts = await api.listGroupContexts(id);
    expect(contexts.data?.[0]).toMatchObject({ contextId: id, alias: "general" });

    await api.setSubgroupVisibility(id, { subgroupVisibility: "restricted" });
    expect(h.client.updateTeam).toHaveBeenLastCalledWith("org-1", "team-2", { join: "invite" });
    expect((await api.listMembers(id)).data?.members.map((m) => m.identity)).toEqual(["acct-me"]);
    await api.addGroupMember(id, "acct-bob");
    expect(h.state.apps.get(id)!.access).toEqual({ kind: "team", team: "team-2" });
    const members = await api.listMembers(id);
    expect(members.data?.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);

    expect((await api.deleteGroup(id)).error).toBeNull();
    expect(h.client.deleteTeam).toHaveBeenCalledWith("org-1", "team-2", expect.anything());
    expect(h.client.deleteApp).not.toHaveBeenCalled();
  });

  it("joining a channel needs nothing but reaching it", async () => {
    h.state.apps.set("app-9", { appId: "app-9", name: "x", owner: "o", org: "org-1", access: { kind: "org" } });
    const res = await api.joinGroupContext("org-1", { contextId: "app-9" });
    expect(res.data).toEqual({ contextId: "app-9", memberPublicKey: "acct-me" });
  });
});

describe("an org made for another app is not a workspace", () => {
  /** The account of the bug: in `overworld`, which holds only a Mero Blocks world. */
  function overworld(): void {
    h.state.orgs.set("ow", {
      orgId: "ow",
      name: "overworld",
      members: { "acct-me": "owner" },
      memberMetadata: {},
      defaultCapabilities: 4,
      capabilities: {},
      metadata: null,
    });
    h.state.apps.set("blocks-1", {
      appId: "blocks-1",
      name: "overworld",
      owner: "acct-me",
      org: "ow",
      bundle: "blocks-bundle",
      package: "com.calimero.mero-blocks",
      access: { kind: "org" },
      metadata: null,
    });
  }

  it("is not listed, so nothing is preselected or entered", async () => {
    overworld();
    expect((await api.listGroups()).data).toEqual([]);
  });

  it("is offered under connect, labelled with what it holds", async () => {
    overworld();
    const others = await api.listOtherOrgs();
    expect(others.map((o) => [o.orgId, o.name, o.label])).toEqual([["ow", "overworld", "Hyperfeed Blocks: overworld"]]);
  });

  it("becomes a workspace once #general is created in it, and stays resumable", async () => {
    overworld();
    await createChannel("ow", "general", true);
    invalidate();
    expect((await api.listGroups()).data).toEqual([expect.objectContaining({ groupId: "ow", alias: "overworld" })]);
    expect(await api.listOtherOrgs()).toEqual([]);
    expect(h.client.createApp).toHaveBeenCalledWith("general", "bundle-hash", expect.objectContaining({ org: "ow" }));
  });
});

describe("a person's name and picture are the workspace's member metadata", () => {
  function store() {
    vi.mocked(h.client.setMemberMetadata).mockImplementation((async (org: string, account: string, metadata: unknown) => {
      (h.state.orgs.get(org)!.memberMetadata as Record<string, unknown>)[account] = metadata;
    }) as never);
  }

  it("a rename keeps the picture, and a new picture keeps the name", async () => {
    store();
    await api.createGroup({ applicationId: "x", name: "Team" });
    await setMemberAvatar("org-1", "acct-me", { blob: "b".repeat(64), app: "app-9" });
    await api.setMemberMetadata("org-1", "acct-me", { name: "Ann" });
    expect(h.state.orgs.get("org-1")!.memberMetadata).toEqual({
      "acct-me": { name: "Ann", avatar: { blob: "b".repeat(64), app: "app-9" } },
    });
    await setMemberAvatar("org-1", "acct-me", { blob: "c".repeat(64), app: "app-9" });
    const org = await getOrgRecord("org-1");
    expect(memberName(org, "acct-me")).toBe("Ann");
    expect(memberAvatar(org, "acct-me")).toEqual({ blob: "c".repeat(64), app: "app-9" });
  });

  it("is written to the workspace even when asked from inside a channel", async () => {
    store();
    await api.createGroup({ applicationId: "x", name: "Team" });
    const general = await createChannel("org-1", "general", true);
    const id = (general as { contextId: string }).contextId;
    await api.setMemberMetadata(id, "acct-me", { name: "Ann" });
    expect(h.client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-me", { name: "Ann" });
  });

  it("reads no picture from a malformed record", () => {
    const org = { memberMetadata: { a: { avatar: "x" }, b: { avatar: { blob: "", app: "y" } } } } as never;
    expect(memberAvatar(org, "a")).toBeUndefined();
    expect(memberAvatar(org, "b")).toBeUndefined();
  });
});
