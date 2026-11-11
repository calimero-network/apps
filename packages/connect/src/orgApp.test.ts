import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient, CalimeroSession, MethodOptions, PasskeyProvider } from "@calimero-network/mero-js";

import { NoAppTeamError } from "./appTeams";
import { orgCluster } from "./testing";

import {
  AppTeamAdminError,
  adoptAppTeam,
  appInvite,
  appOnlyInviteNote,
  appPeople,
  appTeamIdIn,
  createAppOrg,
  isAppOnly,
  leaveApp,
  leaveOrg,
  orgInstanceOptions,
  orgModeOf,
  orgWideAccess,
  removeFromApp,
  removeFromPrivateTeam,
  sourcePackage,
} from "./orgApp";

const PKG = "com.calimero.mero-crm";
const SOURCE = { package: PKG };
const passkey = {} as PasskeyProvider;

type Team = {
  parent: string | null;
  members: Record<string, boolean>;
  join: "everyone" | "invite";
  removed: string[];
  metadata?: unknown;
};
type View = { members: Record<string, string>; mode?: string; teams: Record<string, Team>; metadata?: unknown };

const appTeam = (pkg: string, join: "everyone" | "invite", members: Record<string, boolean> = { me: true }): Team => ({
  parent: null,
  members,
  join,
  removed: [],
  metadata: { app: { package: pkg } },
});

/** A cluster holding one org, answering as core does for its teams and mode. */
function cluster(view: View, me = "me") {
  const modeOf = () => {
    const apps = Object.values(view.teams).filter((t) => !t.parent && t.metadata);
    if (view.mode === undefined) return undefined;
    if (apps.length === 0) return "legacy" as const;
    return apps.some((t) => t.join === "invite") ? ("shared" as const) : ("standalone" as const);
  };
  const orgs = {
    create: vi.fn(async (_args: { name: string }) => ({ orgId: "org" })),
    get: vi.fn(async (_args: { org: string }) => ({
      releaseApprovers: [],
      publishes: [],
      newWorkStopped: null,
      ...structuredClone(view),
      mode: modeOf(),
    })),
    metadata: vi.fn(async ({ metadata }: { org: string; metadata: unknown }) => {
      view.metadata = metadata;
      return {};
    }),
    capabilities: vi.fn(async (_args: { org: string; capabilities: number }, _options?: MethodOptions) => ({})),
    appTeamsScope: vi.fn(
      async (body: { org: string; apps?: Array<{ package: string }>; shared?: boolean }, _options?: MethodOptions) => {
        const pkg = body.apps![0]!.package;
        view.teams["team-new"] = appTeam(pkg, "everyone", { [me]: true });
        if (body.shared) for (const t of Object.values(view.teams)) if (!t.parent && t.metadata) t.join = "invite";
        return { mode: modeOf() ?? "standalone", teams: [{ package: pkg, teamId: "team-new", created: true, apps: [], added: 0 }] };
      },
    ),
    appTeamList: vi.fn(async (_args: { org: string }) => {
      if (view.mode === undefined) throw Object.assign(new Error("no route"), { status: 404 });
      return {
        mode: modeOf()!,
        appTeams: Object.entries(view.teams)
          .filter(([, t]) => !t.parent && t.metadata)
          .map(([teamId, t]) => ({
            package: (t.metadata as { app: { package: string } }).app.package,
            teamId,
            name: teamId,
            join: t.join,
            memberCount: 1,
            defaultCapabilities: null,
            member: me in t.members || (t.join === "everyone" && me in view.members),
            manages: false,
          })),
      };
    }),
    inviteCreate: vi.fn(async (_args: { org: string }, _options?: MethodOptions) => ({ token: "tok-1" })),
    removeMember: vi.fn(async (_args: { org: string; account: string }, _options?: MethodOptions) => ({})),
    teamRemoveMember: vi.fn(
      async ({ team, account }: { org: string; team: string; account: string }, _options?: MethodOptions) => {
        delete view.teams[team]!.members[account];
        return {};
      },
    ),
  };
  const c = { view, session: { accountId: me } as CalimeroSession, orgs };
  // The mocks answer only what the org-app module reads, so the client's types are asserted.
  return c as typeof c & Pick<CalimeroClient, "orgs">;
}

/** The per-call options of a step-up answered with the passkey. */
const CONFIRMED = { confirm: expect.any(Function) };

const legacy = (): View => ({ members: { me: "owner", bob: "member" }, mode: "legacy", teams: {} });
const standalone = (): View => ({
  members: { me: "owner", bob: "member", gus: "guest" },
  mode: "standalone",
  teams: { "team-crm": appTeam(PKG, "everyone") },
});
const shared = (): View => ({
  members: { me: "owner", bob: "member", cy: "member" },
  mode: "shared",
  teams: {
    "team-crm": appTeam(PKG, "invite", { me: true, bob: false }),
    "team-chat": appTeam("com.calimero.chat", "invite", { cy: false }),
  },
});

describe("reading an org", () => {
  it("a raw bundle has no package", () => {
    expect(sourcePackage("bundle-hash")).toBeNull();
    expect(sourcePackage(null)).toBeNull();
    expect(sourcePackage(SOURCE)).toBe(PKG);
  });

  it("the mode, the app's team, and whether it keeps its own people", () => {
    expect(orgModeOf({ mode: "shared" })).toBe("shared");
    expect(orgModeOf({ mode: "nonsense" })).toBeNull();
    expect(appTeamIdIn(shared(), PKG)).toBe("team-crm");
    expect(appTeamIdIn(shared(), null)).toBeNull();
    expect(appTeamIdIn({ teams: { c: { ...appTeam(PKG, "invite"), parent: "t" } } }, PKG)).toBeNull();
    expect(isAppOnly(shared(), PKG)).toBe(true);
    expect(isAppOnly(standalone(), PKG)).toBe(false);
    expect(appOnlyInviteNote("Mero CRM")).toMatch(/^Invites to Mero CRM only/);
  });

  it("appPeople: the team's, else the org's (no guest once the org has app teams)", () => {
    expect(appPeople(shared(), PKG)).toEqual(["me", "bob"]);
    expect(appPeople(standalone(), PKG)).toEqual(["me", "bob"]);
    expect(appPeople({ ...legacy(), members: { me: "owner", gus: "guest" } }, PKG)).toEqual(["me", "gus"]);
    // An org with app teams where the caller sees none of this app's: nobody (#819).
    expect(appPeople({ ...standalone(), teams: {} }, PKG)).toEqual([]);
    expect(appPeople({ ...shared(), teams: { "team-chat": shared().teams["team-chat"]! } }, PKG)).toEqual([]);
    expect(appPeople({ ...standalone(), teams: {} }, null)).toEqual(["me", "bob"]);
    expect(appPeople(shared(), null)).toEqual(["me", "bob", "cy"]);
  });
});

describe("creating a workspace", () => {
  it("a new org is marked for the app, gets its defaults, and an open team (standalone)", async () => {
    const c = cluster(legacy());
    const made = await createAppOrg(c, "Acme", SOURCE, () => passkey, { capabilities: 7 });
    expect(made).toEqual({ orgId: "org", teamId: "team-new", capabilitiesError: null });
    expect(c.orgs.metadata).toHaveBeenCalledWith({ org: "org", metadata: { createdFor: PKG } });
    expect(c.orgs.capabilities).toHaveBeenCalledWith({ org: "org", capabilities: 7 }, CONFIRMED);
    expect(c.orgs.appTeamsScope).toHaveBeenCalledWith({ org: "org", apps: [{ package: PKG }], shared: false }, CONFIRMED);
    expect(c.view.teams["team-new"]!.join).toBe("everyone");
  });

  it("declined defaults and a declined team still leave the org (a legacy one)", async () => {
    const c = cluster(legacy());
    c.orgs.capabilities.mockRejectedValueOnce(new Error("declined"));
    c.orgs.appTeamsScope.mockRejectedValueOnce(new Error("declined"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const made = await createAppOrg(c, "Acme", SOURCE, passkey, { capabilities: 7 });
    warn.mockRestore();
    expect(made.orgId).toBe("org");
    expect(made.teamId).toBeNull();
    expect(made.capabilitiesError).toBeInstanceOf(Error);
  });

  it("a raw bundle: no team asked for", async () => {
    const c = cluster(legacy());
    expect((await createAppOrg(c, "Acme", "bundle-hash", passkey)).teamId).toBeNull();
    expect(c.orgs.appTeamsScope).not.toHaveBeenCalled();
    expect(c.orgs.capabilities).not.toHaveBeenCalled();
  });

  it("adoptAppTeam passes `shared` explicitly: closed only in an org that is shared already", async () => {
    const open = cluster({ ...standalone(), teams: { "team-chat": appTeam("com.calimero.chat", "everyone") } });
    await adoptAppTeam(open, "org", SOURCE, passkey);
    expect(open.orgs.appTeamsScope).toHaveBeenCalledWith({ org: "org", apps: [{ package: PKG }], shared: false }, CONFIRMED);
    expect(open.view.teams["team-chat"]!.join).toBe("everyone");
    const closed = cluster({ ...shared(), teams: { "team-chat": appTeam("com.calimero.chat", "invite") } });
    await adoptAppTeam(closed, "org", SOURCE, passkey);
    expect(closed.orgs.appTeamsScope).toHaveBeenCalledWith({ org: "org", apps: [{ package: PKG }], shared: true }, CONFIRMED);
  });
});

describe("adding the app to an org (orgWideAccess)", () => {
  it("the app's team where it has one; organization access in a legacy org or on an older node", async () => {
    expect(await orgWideAccess(cluster(standalone(), "bob"), "org", SOURCE, passkey, "Mero CRM")).toEqual({
      kind: "team",
      team: "team-crm",
    });
    const old = cluster(legacy());
    expect(await orgWideAccess(old, "org", SOURCE, passkey, "Mero CRM")).toEqual({ kind: "org" });
    expect(await orgWideAccess(cluster({ ...legacy(), mode: undefined }), "org", SOURCE, passkey, "Mero CRM")).toEqual({
      kind: "org",
    });
    expect(await orgWideAccess(cluster(standalone()), "org", "bundle-hash", passkey, "Mero CRM")).toEqual({ kind: "org" });
    expect(old.orgs.appTeamsScope).not.toHaveBeenCalled();
  });

  it("an admin of an org whose other apps have teams: open in a standalone org, closed in a shared one", async () => {
    const open = cluster({ members: { me: "admin" }, mode: "standalone", teams: { c: appTeam("com.calimero.chat", "everyone") } });
    expect(await orgWideAccess(open, "org", SOURCE, passkey, "Mero CRM")).toEqual({ kind: "team", team: "team-new" });
    expect(open.orgs.appTeamsScope).toHaveBeenCalledWith({ org: "org", apps: [{ package: PKG }], shared: false }, CONFIRMED);
    expect(open.view.teams.c!.join).toBe("everyone");
    const closed = cluster({ members: { me: "admin" }, mode: "shared", teams: { c: appTeam("com.calimero.chat", "invite") } });
    await orgWideAccess(closed, "org", SOURCE, passkey, "Mero CRM");
    expect(closed.orgs.appTeamsScope).toHaveBeenCalledWith({ org: "org", apps: [{ package: PKG }], shared: true }, CONFIRMED);
  });

  it("orgInstanceOptions: `{ org }` alone for organization access, as before app teams", async () => {
    expect(await orgInstanceOptions(cluster(legacy()), "org", SOURCE, passkey, "Mero CRM")).toEqual({ org: "org" });
    expect(await orgInstanceOptions(cluster(standalone()), "org", SOURCE, passkey, "Mero CRM")).toEqual({
      org: "org",
      access: { kind: "team", team: "team-crm" },
    });
  });

  it("a member there is told only owners and admins may add it, and nothing is made", async () => {
    const c = cluster({ members: { me: "member" }, mode: "standalone", teams: { c: appTeam("com.calimero.chat", "everyone") } });
    const err = await orgWideAccess(c, "org", SOURCE, passkey, "Mero CRM").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppTeamAdminError);
    expect((err as Error).message).toMatch(/owners and admins can add Mero CRM/);
    expect(c.orgs.appTeamsScope).not.toHaveBeenCalled();
  });
});

describe("invites", () => {
  it("name the app's team; appOnly only in a shared org", async () => {
    const open = cluster(standalone());
    expect(await appInvite(open, "org", SOURCE, passkey)).toEqual({ token: "tok-1", appOnly: false });
    expect(open.orgs.inviteCreate).toHaveBeenCalledWith({ org: "org", role: "member", teams: ["team-crm"] }, CONFIRMED);
    const apart = cluster(shared());
    expect(await appInvite(apart, "org", SOURCE, () => passkey, { teams: ["vault"] })).toEqual({ token: "tok-1", appOnly: true });
    expect(apart.orgs.inviteCreate).toHaveBeenCalledWith({ org: "org", role: "member", teams: ["team-crm", "vault"] }, CONFIRMED);
  });

  it("a legacy org, an older node and a raw bundle: the org-wide invite", async () => {
    for (const [view, source] of [
      [legacy(), SOURCE],
      [{ ...legacy(), mode: undefined }, SOURCE],
      [standalone(), "bundle-hash"],
    ] as const) {
      const c = cluster(structuredClone(view) as View);
      expect(await appInvite(c, "org", source, passkey)).toEqual({ token: "tok-1", appOnly: false });
      expect(c.orgs.inviteCreate.mock.calls[0]![0]).toEqual({ org: "org", role: "member", teams: [] });
    }
  });

  it("carries the invite's validity and uses, in every mode", async () => {
    const apart = cluster(shared());
    await appInvite(apart, "org", SOURCE, passkey, { teams: ["vault"], ttlSecs: 60, uses: 2 });
    expect(apart.orgs.inviteCreate).toHaveBeenCalledWith(
      { org: "org", role: "member", teams: ["team-crm", "vault"], ttlSecs: 60, uses: 2 },
      CONFIRMED,
    );
    const raw = cluster(legacy());
    await appInvite(raw, "org", "bundle-hash", passkey, { ttlSecs: 60 });
    expect(raw.orgs.inviteCreate).toHaveBeenCalledWith({ org: "org", role: "member", teams: [], ttlSecs: 60 }, CONFIRMED);
  });

  it("an org with app teams but none for this app: refused, never widened to the org", async () => {
    const c = cluster({ ...shared(), teams: { "team-chat": appTeam("com.calimero.chat", "invite") } });
    await expect(appInvite(c, "org", SOURCE, passkey)).rejects.toBeInstanceOf(NoAppTeamError);
    expect(c.orgs.inviteCreate).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it("a shared org: off the team and the private teams named, never out of the org", async () => {
    const view = shared();
    view.teams.vault = { parent: null, members: { bob: false }, join: "invite", removed: [] };
    view.teams.other = { parent: null, members: { bob: false }, join: "invite", removed: [] };
    const c = cluster(view);
    c.orgs.teamRemoveMember.mockImplementation(async ({ team }) => {
      if (team === "other") throw new Error("not yours");
      return {};
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await removeFromApp(c, "org", SOURCE, "bob", passkey, { privateTeams: () => ["vault", "other"] })).toBe("app");
    warn.mockRestore();
    expect(c.orgs.teamRemoveMember.mock.calls.map((x) => x[0].team)).toEqual(["team-crm", "vault", "other"]);
    expect(c.orgs.removeMember).not.toHaveBeenCalled();
  });

  it("standalone, legacy and a raw bundle: out of the organization, as before", async () => {
    for (const [view, source] of [
      [standalone(), SOURCE],
      [legacy(), SOURCE],
      [shared(), "bundle-hash"],
    ] as const) {
      const c = cluster(structuredClone(view) as View);
      expect(await removeFromApp(c, "org", source, "bob", passkey)).toBe("org");
      expect(c.orgs.removeMember).toHaveBeenCalledWith({ org: "org", account: "bob" }, CONFIRMED);
      expect(c.orgs.teamRemoveMember).not.toHaveBeenCalled();
    }
  });
});

describe("a private list", () => {
  it("removeFromPrivateTeam takes someone off a folder's team, and refuses an app team", async () => {
    const view = shared();
    view.teams.folder = { parent: null, members: { bob: false }, join: "invite", removed: [] };
    const c = cluster(view);
    await removeFromPrivateTeam(c, "org", "folder", "bob", passkey);
    expect(c.orgs.teamRemoveMember).toHaveBeenCalledWith({ org: "org", team: "folder", account: "bob" }, CONFIRMED);
    await expect(removeFromPrivateTeam(c, "org", "team-crm", "bob", passkey)).rejects.toThrow(/removeFromApp/);
    expect(c.orgs.teamRemoveMember).toHaveBeenCalledTimes(1);
  });
});

describe("leave", () => {
  it("a shared org: this app's team only; lastApp when it was the person's last app there", async () => {
    const c = cluster(shared(), "bob");
    expect(await leaveApp(c, "org", SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(c.orgs.teamRemoveMember).toHaveBeenCalledWith({ org: "org", team: "team-crm", account: "bob" }, CONFIRMED);
    expect(c.orgs.removeMember).not.toHaveBeenCalled();

    const view = shared();
    view.teams["team-chat"]!.members.bob = false;
    const inTwo = cluster(view, "bob");
    expect(await leaveApp(inTwo, "org", SOURCE, passkey)).toEqual({ left: "app", lastApp: false });
  });

  it("standalone and legacy orgs: leaving is leaving the organization", async () => {
    for (const view of [standalone(), legacy()]) {
      const c = cluster(view, "bob");
      expect(await leaveApp(c, "org", SOURCE, passkey)).toEqual({ left: "org", lastApp: false });
      expect(c.orgs.removeMember).toHaveBeenCalledWith({ org: "org", account: "bob" }, CONFIRMED);
    }
  });

  it("the account can be named, for a client without a session", async () => {
    const c = cluster(shared(), "bob");
    (c as { session?: unknown }).session = undefined;
    expect(await leaveApp(c, "org", SOURCE, passkey, { self: "bob" })).toEqual({ left: "app", lastApp: true });
    await leaveOrg(c, "org", passkey, "bob");
    expect(c.orgs.removeMember).toHaveBeenCalledWith({ org: "org", account: "bob" }, CONFIRMED);
    await expect(leaveOrg(c, "org", passkey)).rejects.toThrow(/Sign in/);
  });

  it("leaveOrg takes the account out of the organization", async () => {
    const c = cluster(shared(), "bob");
    await leaveOrg(c, "org", passkey);
    expect(c.orgs.removeMember).toHaveBeenCalledWith({ org: "org", account: "bob" }, CONFIRMED);
  });
});

describe("the module against the shared test cluster (@calimero-apps/connect/testing)", () => {
  it("a new org is standalone with the app's open team; kept apart, invites and Remove are the app's", async () => {
    const cluster = orgCluster();
    const made = await createAppOrg(cluster.client, "Acme", SOURCE, passkey);
    expect(cluster.modeOf(made.orgId)).toBe("standalone");
    expect(made.teamId).toBe(cluster.teamOf(made.orgId, PKG));
    cluster.org(made.orgId).members["acct-bob"] = "member";
    cluster.keepAppsApart(made.orgId);
    expect(cluster.modeOf(made.orgId)).toBe("shared");
    expect((await appInvite(cluster.client, made.orgId, SOURCE, passkey)).appOnly).toBe(true);
    expect(await removeFromApp(cluster.client, made.orgId, SOURCE, "acct-bob", passkey)).toBe("app");
    expect(cluster.org(made.orgId).members["acct-bob"]).toBe("member");
  });

  it("a node without app-team routes: the org stays legacy", async () => {
    const cluster = orgCluster({ noAppTeams: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const made = await createAppOrg(cluster.client, "Acme", SOURCE, passkey);
    warn.mockRestore();
    expect(made.teamId).toBeNull();
    expect(await orgWideAccess(cluster.client, made.orgId, SOURCE, passkey, "X")).toEqual({ kind: "org" });
  });
});
