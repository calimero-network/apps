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
    invite: vi.fn(async () => "tok-1"),
    redeemInvite: vi.fn(async () => ({ org: "org-joined" })),
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
  getAccountId: () => "acct-me",
  chatSource: () => "bundle-hash",
  passkey: () => ({ create: vi.fn(), get: vi.fn() }),
}));

import { invalidate } from "../platform";
import { GroupApiDataSource } from "./groupApiDataSource";
import { ContextApiDataSource } from "./nodeApiDataSource";
import { createChannel } from "../../utils/createChannel";
import { CAN_CREATE_CONTEXT, CAN_CREATE_SUBGROUP } from "../../utils/groupCapabilities";

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
    org.capabilities = { "acct-bob": CAN_CREATE_CONTEXT };
    invalidate();
    expect((await api.getMemberCapabilities("org-1", "acct-bob")).data?.capabilities).toBe(
      CAN_CREATE_CONTEXT | CAN_CREATE_SUBGROUP,
    );
    await api.setMemberCapabilities("org-1", "acct-bob", { capabilities: CAN_CREATE_CONTEXT | CAN_CREATE_SUBGROUP });
    expect(h.client.setCapabilities).toHaveBeenCalledWith("org-1", CAN_CREATE_CONTEXT, expect.anything(), {
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
      { identity: "acct-me", role: "Admin", alias: undefined, orgAdmin: true },
      { identity: "acct-bob", role: "Member", alias: "Bob" },
      { identity: "acct-gus", role: "ReadOnly", alias: undefined },
    ]);
    expect(res.data?.selfIdentity).toBe("acct-me");
  });

  it("invites with an org invite token and joins by redeeming one", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    const invite = await api.createInvitation("org-1");
    expect(invite.data).toEqual({ invitation: "tok-1", groupAlias: "Team" });
    expect(h.client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
    const joined = await api.joinGroup({ invitation: "tok-1" });
    expect(joined.data).toEqual({ groupId: "org-joined", memberIdentity: "acct-me" });
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
    expect(ctx.data).toEqual({ contextId: "app-2", memberPublicKey: "acct-me" });
    expect(h.client.createApp).toHaveBeenCalledWith("secret", "bundle-hash", {
      org: "org-1",
      access: { kind: "accounts", accounts: ["acct-bob"] },
      initArgs: { name: "secret", contextType: "Channel", description: "", creatorUsername: "me" },
    });
  });

  it("an open channel reaches every org member; a private one its owner and the listed accounts", async () => {
    await api.createGroup({ applicationId: "x", name: "Team" });
    h.state.orgs.get("org-1")!.members = { "acct-me": "owner", "acct-bob": "member" };
    invalidate();
    const general = await createChannel("org-1", "general", true, {
      createSubgroup: (...a) => api.createSubgroup(...a),
      setSubgroupVisibility: (...a) => api.setSubgroupVisibility(...a),
      createGroupContext: (...a) => new ContextApiDataSource().createGroupContext(...a),
      joinChat: async () => ({ data: "ok", error: null }),
    });
    const id = (general as { contextId: string }).contextId;
    expect(h.state.apps.get(id)!.access).toEqual({ kind: "org" });

    const info = await api.getGroup(id);
    expect(info.data).toMatchObject({ subgroupVisibility: "open", memberCount: 2, alias: "general" });
    const subgroups = await api.listSubgroups("org-1");
    expect(subgroups.data).toEqual([{ groupId: id, alias: "general" }]);
    const contexts = await api.listGroupContexts(id);
    expect(contexts.data?.[0]).toMatchObject({ contextId: id, alias: "general" });

    await api.setSubgroupVisibility(id, { subgroupVisibility: "restricted" });
    expect(h.state.apps.get(id)!.access).toEqual({ kind: "accounts", accounts: [] });
    await api.addGroupMember(id, "acct-bob");
    expect(h.state.apps.get(id)!.access).toEqual({ kind: "accounts", accounts: ["acct-bob"] });
    const members = await api.listMembers(id);
    expect(members.data?.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
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
    expect(others.map((o) => [o.orgId, o.name, o.label])).toEqual([["ow", "overworld", "Mero Blocks: overworld"]]);
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
