import { describe, expect, it, vi } from "vitest";
import { NotFound, ORG_CAPABILITIES, type AppTeam, type CalimeroSession, type PasskeyProvider } from "@calimero-network/mero-js";

import {
  NoAppTeamError,
  appAccess,
  appTeamMembers,
  appTeamOf,
  appTeams,
  createAppTeam,
  ensureAppTeam,
  inviteToApp,
  isNotFound,
  membersMayInvite,
  setMembersMayInvite,
} from "./appTeams";

const CHAT = "com.calimero.chat";
const BLOCKS = "com.calimero.mero-blocks";
const INVITE = ORG_CAPABILITIES.INVITE_MEMBERS;
const passkey = {} as PasskeyProvider;

function team(pkg: string, over: Partial<AppTeam> = {}): AppTeam {
  return {
    package: pkg,
    teamId: `team-${pkg.split(".").pop()}`,
    name: pkg.split(".").pop() ?? pkg,
    join: "invite",
    memberCount: 3,
    defaultCapabilities: null,
    member: true,
    manages: false,
    ...over,
  };
}

interface FakeOpts {
  mode?: "legacy" | "standalone" | "shared";
  teams?: AppTeam[];
  /** The node has no app-team route (before core#4890). */
  noRoute?: boolean;
  role?: string;
  account?: string | null;
  orgCaps?: number;
  rows?: Record<string, Record<string, number>>;
}

function fake(opts: FakeOpts = {}) {
  const account = opts.account === undefined ? "me" : opts.account;
  return {
    session: account ? ({ accountId: account } as CalimeroSession) : undefined,
    listAppTeams: vi.fn(async () => {
      if (opts.noRoute) throw new NotFound("no such route");
      return { mode: opts.mode ?? "shared", appTeams: opts.teams ?? [] };
    }),
    getOrg: vi.fn(async () => ({
      releaseApprovers: [],
      publishes: [],
      newWorkStopped: null,
      members: opts.role ? { me: opts.role } : {},
      ...(opts.orgCaps !== undefined ? { capabilities: { me: opts.orgCaps } } : {}),
      teams: Object.fromEntries(
        Object.entries(opts.rows ?? {}).map(([id, caps]) => [id, { parent: null, members: {}, capabilities: caps }]),
      ),
    })),
    scopeApps: vi.fn(async (_org: string, _p: PasskeyProvider, o: { apps?: Array<{ package: string }> } = {}) => ({
      mode: "standalone" as const,
      teams: (o.apps ?? []).map((a) => ({ package: a.package, teamId: `new-${a.package}`, created: true, apps: [], added: 1 })),
    })),
    invite: vi.fn(async () => "tok-1"),
    setTeamDefaultCapabilities: vi.fn(async () => undefined),
  };
}

describe("isNotFound", () => {
  it("is the node's 404, typed or by status", () => {
    expect(isNotFound(new NotFound("x"))).toBe(true);
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ status: 403 })).toBe(false);
    expect(isNotFound(new Error("x"))).toBe(false);
  });
});

describe("appTeams / appTeamOf", () => {
  it("reads the mode and the package's team", async () => {
    const c = fake({ teams: [team(CHAT), team(BLOCKS)] });
    expect((await appTeams(c, "org"))?.appTeams).toHaveLength(2);
    const found = await appTeamOf(c, "org", BLOCKS);
    expect(found?.mode).toBe("shared");
    expect(found?.team?.teamId).toBe("team-mero-blocks");
  });

  it("answers team null for a package without one", async () => {
    expect(await appTeamOf(fake({ mode: "legacy" }), "org", CHAT)).toEqual({ mode: "legacy", team: null });
  });

  it("answers null on a node without the route (404)", async () => {
    expect(await appTeams(fake({ noRoute: true }), "org")).toBeNull();
    expect(await appTeamOf(fake({ noRoute: true }), "org", CHAT)).toBeNull();
  });

  it("throws anything else", async () => {
    const c = fake();
    c.listAppTeams.mockRejectedValueOnce(new Error("offline"));
    await expect(appTeams(c, "org")).rejects.toThrow("offline");
  });
});

describe("createAppTeam / ensureAppTeam", () => {
  it("scopes one package, with the name, instances and shared flag given", async () => {
    const c = fake();
    const made = await createAppTeam(c, "org", CHAT, passkey, { name: "Chat", instances: [], shared: true });
    expect(c.scopeApps).toHaveBeenCalledWith("org", passkey, {
      apps: [{ package: CHAT, name: "Chat", instances: [] }],
      shared: true,
    });
    expect(made).toMatchObject({ teamId: `new-${CHAT}`, created: true, mode: "standalone" });
  });

  it("leaves out what was not given, so the node's defaults apply", async () => {
    const c = fake();
    await createAppTeam(c, "org", CHAT, passkey);
    expect(c.scopeApps).toHaveBeenCalledWith("org", passkey, { apps: [{ package: CHAT }] });
  });

  it("ensure: never asks for a passkey when the team exists", async () => {
    const c = fake({ teams: [team(CHAT)] });
    expect(await ensureAppTeam(c, "org", CHAT, passkey)).toEqual({
      teamId: "team-chat",
      created: false,
      mode: "shared",
    });
    expect(c.scopeApps).not.toHaveBeenCalled();
  });

  it("ensure: makes it when missing; null on an older node", async () => {
    const c = fake({ mode: "legacy" });
    expect((await ensureAppTeam(c, "org", CHAT, passkey))?.created).toBe(true);
    expect(await ensureAppTeam(fake({ noRoute: true }), "org", CHAT, passkey)).toBeNull();
  });
});

describe("inviteToApp", () => {
  it("names the app team, as a member by default", async () => {
    const c = fake({ teams: [team(CHAT), team(BLOCKS)] });
    const made = await inviteToApp(c, "org", CHAT, { passkey });
    expect(c.invite).toHaveBeenCalledWith("org", "member", passkey, ["team-chat"], undefined);
    expect(made).toEqual({ token: "tok-1", teams: ["team-chat"], mode: "shared" });
  });

  it("names several apps' teams, plus extra teams, with role, uses and ttl", async () => {
    const c = fake({ teams: [team(CHAT), team(BLOCKS)] });
    await inviteToApp(c, "org", [CHAT, BLOCKS], { passkey, role: "guest", teams: ["private"], uses: 3, ttlSecs: 60 });
    expect(c.invite).toHaveBeenCalledWith("org", "guest", passkey, ["team-chat", "team-mero-blocks", "private"], {
      uses: 3,
      ttlSecs: 60,
    });
  });

  it("refuses a package without a team in an org that has app teams, rather than invite org-wide", async () => {
    const c = fake({ teams: [team(CHAT)] });
    await expect(inviteToApp(c, "org", BLOCKS, { passkey })).rejects.toBeInstanceOf(NoAppTeamError);
    expect(c.invite).not.toHaveBeenCalled();
  });

  it("falls back to today's org-wide invite in a legacy org and on an older node", async () => {
    const legacy = fake({ mode: "legacy" });
    expect(await inviteToApp(legacy, "org", CHAT, { passkey })).toEqual({ token: "tok-1", teams: [], mode: "legacy" });
    expect(legacy.invite).toHaveBeenCalledWith("org", "member", passkey, undefined, undefined);
    const old = fake({ noRoute: true });
    expect((await inviteToApp(old, "org", CHAT, { passkey })).mode).toBeNull();
    expect(old.invite).toHaveBeenCalledWith("org", "member", passkey, undefined, undefined);
  });
});

describe("appAccess: the owner's decisions", () => {
  it("standalone: a member may invite (the team default holds INVITE_MEMBERS)", async () => {
    const c = fake({ mode: "standalone", role: "member", teams: [team(CHAT, { join: "everyone", defaultCapabilities: INVITE })] });
    expect(await appAccess(c, "org", CHAT)).toMatchObject({ mode: "standalone", member: true, manages: false, mayInvite: true });
  });

  it("shared: a plain member may not invite by default", async () => {
    const c = fake({ role: "member", teams: [team(CHAT)] });
    expect(await appAccess(c, "org", CHAT)).toMatchObject({ mode: "shared", member: true, manages: false, mayInvite: false });
  });

  it("shared: a member may once the app's switch is on", async () => {
    const c = fake({ role: "member", teams: [team(CHAT, { defaultCapabilities: INVITE })] });
    expect((await appAccess(c, "org", CHAT)).mayInvite).toBe(true);
  });

  it("shared: a member's own row on the team wins over the team default", async () => {
    const c = fake({ role: "member", teams: [team(CHAT, { defaultCapabilities: INVITE })], rows: { "team-chat": { me: 0 } } });
    expect((await appAccess(c, "org", CHAT)).mayInvite).toBe(false);
    const granted = fake({ role: "member", teams: [team(CHAT)], rows: { "team-chat": { me: INVITE } } });
    expect((await appAccess(granted, "org", CHAT)).mayInvite).toBe(true);
  });

  it("shared: someone not in the app may not invite to it, even with the switch on", async () => {
    const c = fake({ role: "member", teams: [team(CHAT, { member: false, defaultCapabilities: INVITE })] });
    expect(await appAccess(c, "org", CHAT)).toMatchObject({ member: false, mayInvite: false });
  });

  it("a lead and an admin manage and invite", async () => {
    const lead = fake({ role: "member", teams: [team(CHAT, { manages: true })] });
    expect(await appAccess(lead, "org", CHAT)).toMatchObject({ manages: true, mayInvite: true });
    const admin = fake({ role: "admin", teams: [team(CHAT, { member: false })] });
    expect(await appAccess(admin, "org", CHAT)).toMatchObject({ role: "admin", manages: true, mayInvite: true });
  });

  it("a guest of an org with app teams has no app without a row", async () => {
    const c = fake({ role: "guest", mode: "shared", teams: [] });
    expect(await appAccess(c, "org", CHAT)).toMatchObject({ team: null, member: false, mayInvite: false });
  });

  it("legacy / older node: the org decides (members in, admins invite)", async () => {
    expect(await appAccess(fake({ mode: "legacy", role: "member" }), "org", CHAT)).toMatchObject({
      mode: "legacy",
      member: true,
      manages: false,
      mayInvite: false,
    });
    expect(await appAccess(fake({ noRoute: true, role: "member", orgCaps: INVITE }), "org", CHAT)).toMatchObject({
      mode: null,
      member: true,
      mayInvite: true,
    });
    expect(await appAccess(fake({ noRoute: true, role: "guest" }), "org", CHAT)).toMatchObject({ member: true, mayInvite: false });
  });

  it("outside the org: nothing", async () => {
    expect(await appAccess(fake({ noRoute: true }), "org", CHAT)).toMatchObject({ role: null, member: false, mayInvite: false });
  });
});

describe("members may invite: the per-app switch", () => {
  it("reads the team default", () => {
    expect(membersMayInvite({ defaultCapabilities: null })).toBe(false);
    expect(membersMayInvite({ defaultCapabilities: INVITE | 1 })).toBe(true);
  });

  it("sets or clears INVITE_MEMBERS and keeps every other bit", async () => {
    const c = fake();
    expect(await setMembersMayInvite(c, "org", { teamId: "t", defaultCapabilities: 1 }, true, passkey)).toBe(1 | INVITE);
    expect(c.setTeamDefaultCapabilities).toHaveBeenLastCalledWith("org", "t", 1 | INVITE, passkey);
    expect(await setMembersMayInvite(c, "org", { teamId: "t", defaultCapabilities: 1 | INVITE }, false, passkey)).toBe(1);
    expect(await setMembersMayInvite(c, "org", { teamId: "t", defaultCapabilities: null }, false, passkey)).toBe(0);
  });
});

describe("appTeamMembers: who is in an app team", () => {
  const JOIN = ORG_CAPABILITIES.JOIN_OPEN_TEAMS;
  const org = (join: "everyone" | "invite", over: Record<string, unknown> = {}) => ({
    members: { ana: "owner", bob: "member", cy: "member", gus: "guest", dee: "admin" },
    defaultCapabilities: JOIN,
    capabilities: {} as Record<string, number>,
    teams: { chat: { members: { ana: true, gus: false } as Record<string, boolean>, join, removed: [] as string[], ...over } },
  });

  it("a closed team: its rows only, in org order", () => {
    expect(appTeamMembers(org("invite"), "chat", "shared")).toEqual(["ana", "gus"]);
  });

  it("an open team: everyone in the org who joins open teams, and its rows", () => {
    // gus is a guest of an org with app teams, but has a row.
    expect(appTeamMembers(org("everyone"), "chat", "standalone")).toEqual(["ana", "bob", "cy", "gus", "dee"]);
  });

  it("an open team leaves out who was taken out of it and who may not join open teams", () => {
    const view = org("everyone", { removed: ["bob"] });
    view.capabilities = { cy: 0 };
    // gus has a row, so he is in; dee is an admin and holds every capability.
    expect(appTeamMembers(view, "chat", "standalone")).toEqual(["ana", "gus", "dee"]);
  });

  it("a guest without a row is in an open team only in a legacy org; a row for someone gone does not count", () => {
    const view = org("everyone");
    view.teams.chat.members = { ana: true, zed: false };
    expect(appTeamMembers(view, "chat", "legacy")).toEqual(["ana", "bob", "cy", "gus", "dee"]);
    expect(appTeamMembers(view, "chat", "standalone")).toEqual(["ana", "bob", "cy", "dee"]);
  });

  it("a team the caller does not see: nobody", () => {
    expect(appTeamMembers(org("invite"), "blocks", "shared")).toEqual([]);
  });
});
