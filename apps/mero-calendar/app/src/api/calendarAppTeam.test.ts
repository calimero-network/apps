/**
 * Mero Calendar's own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's: a new team gets an open app team and
 * calendars go on it; invites name it; the member list is its people; Remove
 * and Leave in an org that keeps its apps apart keep the person in the org;
 * a legacy org works as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsentRequest, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";
import { appInviteTeams } from "@calimero-apps/connect";
import { orgCluster } from "@calimero-apps/connect/testing";
import { confirmConsentHandoff } from "@calimero-apps/passkey";

import { CONSENT_INTENT_KEY, StayedInApp } from "./consent";
import {
  createCalendar,
  deleteTeam,
  finishTeam,
  leaveTeam,
  leaveTeamOrg,
  readOrg,
  removeTeamMember,
  setTeamRole,
} from "./teams";

// The hand-off dialog before the consent page: "Continue" unless a test says otherwise.
vi.mock("@calimero-apps/passkey", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmConsentHandoff: vi.fn(async () => true),
}));

const PKG = "com.calimero.mero-calendar";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;
const add = (cluster: ReturnType<typeof orgCluster>, org: string) => createCalendar(cluster.client, SOURCE, org, "Work", passkey);

/** An org as the node's consent page makes it, then what the app does after. */
async function createTeam(client: ReturnType<typeof orgCluster>["client"], name: string, passkey: () => PasskeyProvider, source?: AppSource) {
  const { orgId } = await client.orgs.create({ name });
  return finishTeam(client, orgId, passkey, source);
}

async function team(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { groupId: org, warning } = await createTeam(cluster.client, "Acme", passkey, SOURCE);
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new team gets Mero Calendar's own app team", () => {
  it("open (made with `shared: false`), and a calendar goes on it", async () => {
    const { cluster, org } = await team();
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const app = await add(cluster, org);
    expect(cluster.state.apps.get(app)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("a declined team leaves a legacy org, whose calendars use organization access as before", async () => {
    const cluster = orgCluster();
    cluster.state.declined.add("scopeApps");
    const { groupId: org } = await createTeam(cluster.client, "Acme", passkey, SOURCE);
    expect(cluster.modeOf(org)).toBe("legacy");
    await add(cluster, org);
    expect((cluster.callsOf("createApp")[0]![2] as { access?: unknown }).access).toBeUndefined();
  });

  it("a raw dev bundle has no package: no team is asked for", async () => {
    const cluster = orgCluster();
    await createTeam(cluster.client, "Acme", passkey, "bundle-hash");
    expect(cluster.callsOf("scopeApps")).toEqual([]);
  });
});

describe("invites and people", () => {
  const people = { "acct-bob": "member", "acct-cy": "member", "acct-gus": "guest" };

  it("standalone: the invite names the team; every member but a guest is listed", async () => {
    const { cluster, org } = await team(people);
    expect(await appInviteTeams(cluster.client, org, SOURCE)).toEqual({ teams: [cluster.teamOf(org, PKG)], appOnly: false });
    expect((await readOrg(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob", "acct-cy"]);
  });

  it("apps kept apart: Mero Calendar only, and only its people", async () => {
    const { cluster, org } = await team(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await appInviteTeams(cluster.client, org, SOURCE)).appOnly).toBe(true);
    const read = await readOrg(cluster.client, org, SOURCE);
    expect(read.people).toEqual(["acct-me", "acct-bob"]);
    expect(read.appOnly).toBe(true);
    expect(read.roles.get("acct-cy")).toBe("member");
  });

  it("a legacy org: the org-wide invite, every member listed", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: people });
    expect(await appInviteTeams(cluster.client, org, SOURCE)).toEqual({ teams: [], appOnly: false });
    expect((await readOrg(cluster.client, org, SOURCE)).people).toHaveLength(4);
  });
});

describe("Remove and Leave", () => {
  it("apps kept apart: Remove takes the person out of Mero Calendar, never the org", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    cluster.keepAppsApart(org);
    expect(await removeTeamMember(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("app");
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
    expect((await readOrg(cluster.client, org, SOURCE)).people).not.toContain("acct-bob");
  });

  it("standalone: Remove takes the person off Mero Calendar's team; they stay in the org", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    expect(await removeTeamMember(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("app");
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
    expect(cluster.callsOf("removeMember")).toEqual([]);
    expect((await readOrg(cluster.client, org, SOURCE)).people).not.toContain("acct-bob");
  });

  it("legacy: Remove is out of the organization, as before", async () => {
    const cluster = orgCluster();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-bob": "member" } });
    expect(await removeTeamMember(cluster.client, legacy, SOURCE, "acct-bob", passkey)).toBe("org");
    expect(cluster.org(legacy).members["acct-bob"]).toBeUndefined();
  });

  it("apps kept apart: Leave is Mero Calendar only; lastApp, then the org on request", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    cluster.keepAppsApart(org);
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveTeam(cluster.client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    await leaveTeamOrg(cluster.client, org, passkey);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("standalone: Leave is off Mero Calendar's team, and offers the org", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveTeam(cluster.client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    expect(cluster.callsOf("removeMember")).toEqual([]);
  });

  it("legacy: Leave is leaving the organization", async () => {
    const cluster = orgCluster();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-ana": "owner", "acct-me": "member" } });
    expect(await leaveTeam(cluster.client, legacy, SOURCE, passkey)).toEqual({ left: "org", lastApp: false });
    expect(cluster.org(legacy).members["acct-me"]).toBeUndefined();
  });
});

describe("from the app's own frontend (a bound session)", () => {
  /** The cluster's client as a session opened on Mero Calendar's frontend sees it. */
  function bound(cluster: ReturnType<typeof orgCluster>) {
    const openConsentPage = vi.fn(async (request: ConsentRequest, options?: unknown) => {
      const confirm = (options as { confirm?: (s: { requestId: string; code: string }) => Promise<boolean> })?.confirm;
      await confirm?.({ requestId: "req-1", code: "4821" });
      return { requestId: "req-1", code: "4821", request };
    });
    const client = {
      ...cluster.client,
      auth: { ...cluster.client.auth, me: async () => ({ accountId: "acct-me", app: PKG }) },
      openConsentPage,
    } as unknown as typeof cluster.client & { openConsentPage: typeof openConsentPage };
    return { client, openConsentPage };
  }

  const kept = () => JSON.parse(sessionStorage.getItem(CONSENT_INTENT_KEY) ?? "null") as { kind: string } | null;

  beforeEach(() => sessionStorage.clear());

  it("Remove and Leave in an org with Mero Calendar's team are its own: no consent page", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    const { client, openConsentPage } = bound(cluster);
    expect(await removeTeamMember(client, org, SOURCE, "acct-bob", passkey, "Bob")).toBe("app");
    expect(await leaveTeam(client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(openConsentPage).not.toHaveBeenCalled();
  });

  it("a legacy org's Remove, Leave, role and deletion go to the consent page, never to the routes", async () => {
    const cluster = orgCluster();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-me": "owner", "acct-bob": "member" } });
    const { client, openConsentPage } = bound(cluster);

    void removeTeamMember(client, legacy, SOURCE, "acct-bob", passkey, "Bob");
    await vi.waitFor(() => expect(openConsentPage).toHaveBeenCalledTimes(1));
    expect(openConsentPage.mock.calls[0]![0]).toMatchObject({ kind: "removeMember", subject: { org: legacy, account: "acct-bob" } });
    expect(kept()).toMatchObject({ kind: "removeMember", name: "Bob" });

    void leaveTeam(client, legacy, SOURCE, passkey);
    await vi.waitFor(() => expect(openConsentPage).toHaveBeenCalledTimes(2));
    expect(openConsentPage.mock.calls[1]![0]).toMatchObject({ kind: "leaveOrg", subject: { org: legacy } });

    void setTeamRole(client, legacy, "acct-bob", "admin", passkey, "Bob");
    await vi.waitFor(() => expect(openConsentPage).toHaveBeenCalledTimes(3));
    expect(openConsentPage.mock.calls[2]![0]).toMatchObject({ kind: "setMemberRole", subject: { role: "admin" } });

    void deleteTeam(client, legacy, passkey);
    await vi.waitFor(() => expect(openConsentPage).toHaveBeenCalledTimes(4));
    expect(openConsentPage.mock.calls[3]![0]).toMatchObject({ kind: "deleteOrg", subject: { org: legacy } });

    for (const call of ["removeMember", "setMember", "deleteOrg"]) expect(cluster.callsOf(call)).toEqual([]);
    expect(cluster.org(legacy).members["acct-bob"]).toBe("member");
  });

  it("staying in the app changes nothing and keeps no intent", async () => {
    vi.mocked(confirmConsentHandoff).mockResolvedValueOnce(false);
    const cluster = orgCluster();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-me": "owner" } });
    const { client } = bound(cluster);
    await expect(deleteTeam(client, legacy, passkey)).rejects.toBeInstanceOf(StayedInApp);
    expect(kept()).toBeNull();
    expect(cluster.callsOf("deleteOrg")).toEqual([]);
  });

  it("an unbound session makes the change itself", async () => {
    const cluster = orgCluster();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-me": "owner", "acct-bob": "member" } });
    await setTeamRole(cluster.client, legacy, "acct-bob", "admin", passkey);
    expect(cluster.org(legacy).members["acct-bob"]).toBe("admin");
    await deleteTeam(cluster.client, legacy, passkey);
    expect(cluster.callsOf("deleteOrg")).toHaveLength(1);
  });
});

describe("adding Mero Calendar to an organization whose apps have teams", () => {
  it("an admin: open in an open org, closed in one that keeps its apps apart", async () => {
    const cluster = orgCluster();
    const open = cluster.addOrg({ mode: "standalone", role: "admin" });
    await add(cluster, open);
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: "shared", role: "admin" });
    await add(cluster, apart);
    expect(cluster.callsOf("scopeApps")[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it("a member is told only owners and admins can add it, and nothing is made", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "standalone", role: "member" });
    await expect(add(cluster, org)).rejects.toThrow(/owners and admins can add Mero Calendar/);
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
