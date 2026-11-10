/**
 * Mero Design's own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's: a new team gets an open app team and
 * boards go on it; invites name it; the member list is its people; Remove and
 * Leave in an org that keeps its apps apart keep the person in the org; a
 * legacy org works as before.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";
import { orgCluster } from "@calimero-apps/connect/testing";

import { bindApi } from "./client";
import {
  createBoard,
  createTeam,
  createTeamInvitation,
  leaveTeam,
  leaveTeamOrg,
  listGroupMembers,
  readTeam,
  removeTeamMember,
} from "./rpc";

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

async function team(people: Record<string, string> = {}) {
  const cluster = signedIn();
  const { namespaceId: org, warning } = await createTeam("Acme");
  expect(warning).toBeUndefined();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

afterEach(() => bindApi(null));

describe("a new team gets Mero Design's own app team", () => {
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
    expect((await createTeamInvitation(org)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    expect((await listGroupMembers(org)).members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob", "acct-cy"]);
  });

  it("apps kept apart: Mero Design only, and only its people", async () => {
    const { cluster, org } = await team(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await createTeamInvitation(org)).appOnly).toBe(true);
    const listed = await listGroupMembers(org);
    expect(listed.members.map((m) => m.identity)).toEqual(["acct-me", "acct-bob"]);
    expect(listed.appOnly).toBe(true);
    expect((await readTeam(org)).roles.get("acct-cy")).toBe("member");
  });

  it("a legacy org: the org-wide invite, every member listed", async () => {
    const cluster = signedIn();
    const org = cluster.addOrg({ mode: "legacy", members: people });
    expect((await createTeamInvitation(org)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toBeUndefined();
    expect((await listGroupMembers(org)).members).toHaveLength(4);
  });
});

describe("Remove and Leave", () => {
  it("apps kept apart: Remove takes the person out of Mero Design, never the org", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    cluster.keepAppsApart(org);
    expect(await removeTeamMember(org, "acct-bob")).toBe("app");
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
  });

  it("standalone and legacy: Remove is out of the organization, as before", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    expect(await removeTeamMember(org, "acct-bob")).toBe("org");
    expect(cluster.org(org).members["acct-bob"]).toBeUndefined();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-bob": "member" } });
    expect(await removeTeamMember(legacy, "acct-bob")).toBe("org");
  });

  it("apps kept apart: Leave is Mero Design only; lastApp, then the org on request", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    cluster.keepAppsApart(org);
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveTeam(org)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    await leaveTeamOrg(org);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("standalone: Leave is leaving the organization", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    expect(await leaveTeam(org)).toEqual({ left: "org", lastApp: false });
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });
});

describe("adding Mero Design to an organization whose apps have teams", () => {
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
    await expect(createBoard(org, "Moodboard")).rejects.toThrow(/owners and admins can add Mero Design/);
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
