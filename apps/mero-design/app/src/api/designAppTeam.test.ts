/**
 * Hyperfeed Design's own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's: a new team gets an open app team and
 * boards go on it; invites name it; the member list is its people; Remove and
 * Leave in an org that keeps its apps apart keep the person in the org; a
 * legacy org works as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";
import { orgCluster } from "@calimero-apps/connect/testing";

import { bindApi, getApi } from "./client";
import { consentIntent } from "./consent";
import {
  createBoard,
  deleteTeam,
  updateMemberRole,
  teamInviteTeams,
  finishTeam,
  leaveTeam,
  leaveTeamOrg,
  listGroupMembers,
  readTeam,
  removeTeamMember,
} from "./rpc";

// The handoff dialog before the consent page: the person goes.
vi.mock("@calimero-apps/passkey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-apps/passkey")>()),
  confirmConsentHandoff: vi.fn(async () => true),
}));

const PKG = "com.calimero.mero-design";
const SOURCE = { package: PKG };

function signedIn(source: AppSource = SOURCE) {
  const cluster = orgCluster();
  bindApi({
    client: cluster.client,
    accountId: cluster.state.me,
    source,
    passkey: () => ({}) as PasskeyProvider,
    after: () => {},
    scope: "test",
  });
  return cluster;
}

/** An org as the node's consent page makes it, then what the app does after. */
async function createTeam(name: string) {
  const { orgId } = await getApi().client.orgs.create({ name });
  return finishTeam(orgId);
}

async function team(people: Record<string, string> = {}) {
  const cluster = signedIn();
  const { namespaceId: org, warning } = await createTeam("Acme");
  expect(warning).toBeUndefined();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

afterEach(() => bindApi(null));

describe("a new team gets Hyperfeed Design's own app team", () => {
  it("open (made with `shared: false`), and a board goes on it", async () => {
    const { cluster, org } = await team();
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const board = await createBoard(org, "Moodboard");
    expect(cluster.state.apps.get(board)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("a declined team leaves a legacy org, whose boards use organization access as before", async () => {
    const cluster = signedIn();
    cluster.state.declined.add("scopeApps");
    const { namespaceId: org } = await createTeam("Acme");
    expect(cluster.modeOf(org)).toBe("legacy");
    await createBoard(org, "Moodboard");
    expect(cluster.callsOf("createApp")[0]![2]).toEqual({ org });
  });

  it("a raw dev bundle has no package: no team is asked for", async () => {
    const cluster = signedIn("bundle-hash");
    await createTeam("Acme");
    expect(cluster.callsOf("scopeApps")).toEqual([]);
  });
});

describe("invites and people", () => {
  const people = { "acct-bob": "member", "acct-cy": "member", "acct-gus": "guest" };

  it("standalone: the invite names the team; every member but a guest is listed", async () => {
    const { cluster, org } = await team(people);
    expect(await teamInviteTeams(org)).toEqual({ teams: [cluster.teamOf(org, PKG)], appOnly: false });
    expect((await listGroupMembers(org)).members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob", "acct-cy"]);
  });

  it("apps kept apart: Hyperfeed Design only, and only its people", async () => {
    const { cluster, org } = await team(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect(await teamInviteTeams(org)).toEqual({ teams: [cluster.teamOf(org, PKG)], appOnly: true });
    const listed = await listGroupMembers(org);
    expect(listed.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    expect(listed.appOnly).toBe(true);
    expect((await readTeam(org)).roles.get("acct-cy")).toBe("member");
  });

  it("a legacy org: the org-wide invite, every member listed", async () => {
    const cluster = signedIn();
    const org = cluster.addOrg({ mode: "legacy", members: people });
    expect(await teamInviteTeams(org)).toEqual({ teams: [], appOnly: false });
    expect((await listGroupMembers(org)).members).toHaveLength(4);
  });
});

describe("Remove and Leave", () => {
  it("apps kept apart: Remove takes the person out of Hyperfeed Design, never the org", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    cluster.keepAppsApart(org);
    expect(await removeTeamMember(org, "acct-bob")).toBe("app");
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
  });

  it("standalone: Remove takes the person off Hyperfeed Design's team, never out of the org", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    expect(await removeTeamMember(org, "acct-bob")).toBe("app");
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
    expect(cluster.callsOf("removeMember")).toEqual([]);
    expect(cluster.callsOf("removeTeamMember")[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), "acct-bob"]);
  });

  it("legacy: Remove is out of the organization, as before", async () => {
    const cluster = signedIn();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-bob": "member" } });
    expect(await removeTeamMember(legacy, "acct-bob")).toBe("org");
    expect(cluster.org(legacy).members["acct-bob"]).toBeUndefined();
  });

  it("apps kept apart: Leave is Hyperfeed Design only; lastApp, then the org on request", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    cluster.keepAppsApart(org);
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveTeam(org)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    await leaveTeamOrg(org);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("standalone: Leave is off Hyperfeed Design's team; the org is offered after", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    expect(await leaveTeam(org)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBeDefined();
    await leaveTeamOrg(org);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("legacy: Leave is leaving the organization", async () => {
    const cluster = signedIn();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-ana": "owner" } });
    expect(await leaveTeam(legacy)).toEqual({ left: "org", lastApp: false });
    expect(cluster.org(legacy).members["acct-me"]).toBeUndefined();
  });
});

describe("organization-wide changes from the app's frontend go through the consent page", () => {
  /** A session bound to Hyperfeed Design's frontend, whose consent page is approved at once. */
  function boundSession() {
    const cluster = orgCluster();
    const openConsentPage = vi.fn(async (_request: unknown, options: { confirm: (s: { code: string }) => Promise<boolean> }) => {
      await options.confirm({ code: "K7Q2" });
      return { requestId: "req-1", code: "K7Q2" };
    });
    const client = Object.assign(Object.create(cluster.client as object), {
      auth: { me: async () => ({ accountId: cluster.state.me, app: PKG }) },
      openConsentPage,
    }) as typeof cluster.client;
    bindApi({ client, accountId: cluster.state.me, source: SOURCE, passkey: () => ({}) as PasskeyProvider, after: () => {}, scope: "test" });
    return { cluster, openConsentPage };
  }

  afterEach(() => sessionStorage.clear());

  const cases = [
    {
      name: "a role",
      run: (org: string) => updateMemberRole(org, "acct-bob", "Admin"),
      request: { kind: "setMemberRole", subject: { account: "acct-bob", role: "admin" } },
      direct: "setMember",
    },
    { name: "deleting the team", run: (org: string) => deleteTeam(org), request: { kind: "deleteOrg" }, direct: "deleteOrg" },
    { name: "leaving the organization", run: (org: string) => leaveTeamOrg(org), request: { kind: "leaveOrg" }, direct: "removeMember" },
  ];

  for (const c of cases) {
    it(`${c.name}: the consent page, never the route`, async () => {
      const { cluster, openConsentPage } = boundSession();
      const org = cluster.addOrg({ mode: "legacy", members: { "acct-me": "owner", "acct-bob": "member" } });
      void c.run(org);
      await vi.waitFor(() => expect(openConsentPage).toHaveBeenCalled());
      expect(openConsentPage.mock.calls[0]![0]).toMatchObject({ ...c.request, subject: { org, ...(c.request.subject ?? {}) } });
      expect(consentIntent()).toMatchObject({ kind: c.request.kind, org });
      expect(cluster.callsOf(c.direct)).toEqual([]);
    });
  }

  it("Remove in a legacy org: the consent page", async () => {
    const { cluster, openConsentPage } = boundSession();
    const org = cluster.addOrg({ mode: "legacy", members: { "acct-me": "owner", "acct-bob": "member" } });
    void removeTeamMember(org, "acct-bob");
    await vi.waitFor(() => expect(openConsentPage).toHaveBeenCalled());
    expect(openConsentPage.mock.calls[0]![0]).toMatchObject({ kind: "removeMember", subject: { org, account: "acct-bob" } });
    expect(cluster.callsOf("removeMember")).toEqual([]);
  });

  it("Remove and Leave where Hyperfeed Design has its team: the team, no consent page", async () => {
    const { cluster, openConsentPage } = boundSession();
    const org = cluster.addOrg({ mode: "standalone", app: PKG, members: { "acct-ana": "owner", "acct-bob": "member" } });
    expect(await removeTeamMember(org, "acct-bob")).toBe("app");
    expect(await leaveTeam(org)).toEqual({ left: "app", lastApp: true });
    expect(openConsentPage).not.toHaveBeenCalled();
    expect(cluster.callsOf("removeMember")).toEqual([]);
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
  });
});

describe("adding Hyperfeed Design to an organization whose apps have teams", () => {
  it("an admin: open in an open org, closed in one that keeps its apps apart", async () => {
    const cluster = signedIn();
    const open = cluster.addOrg({ mode: "standalone", role: "admin" });
    await createBoard(open, "Moodboard");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: "shared", role: "admin" });
    await createBoard(apart, "Moodboard");
    expect(cluster.callsOf("scopeApps")[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it("a member is told only owners and admins can add it, and nothing is made", async () => {
    const cluster = signedIn();
    const org = cluster.addOrg({ mode: "standalone", role: "member" });
    await expect(createBoard(org, "Moodboard")).rejects.toThrow(/owners and admins can add Hyperfeed Design/);
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
