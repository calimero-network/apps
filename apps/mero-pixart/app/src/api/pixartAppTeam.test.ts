/**
 * Mero Pixart's own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's: a new team gets an open app team and
 * projects go on it; invites name it; the member list is its people; Remove
 * and Leave in an org that keeps its apps apart keep the person in the org;
 * a legacy org works as before.
 */
import { describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import { orgCluster } from "@calimero-apps/connect/testing";

import { createProject, createTeam, inviteToken, leaveTeam, leaveTeamOrg, readOrg, removeTeamMember } from "./teams";

const PKG = "com.calimero.mero-pixart";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;
const add = (cluster: ReturnType<typeof orgCluster>, org: string) => createProject(cluster.client, SOURCE, org, { name: "Doc", description: "", width: 10, height: 10 }, passkey);

async function team(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { groupId: org, warning } = await createTeam(cluster.client, "Acme", passkey, SOURCE);
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new team gets Mero Pixart's own app team", () => {
  it("open (made with `shared: false`), and a project goes on it", async () => {
    const { cluster, org } = await team();
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const app = await add(cluster, org);
    expect(cluster.state.apps.get(app)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("a declined team leaves a legacy org, whose projects use organization access as before", async () => {
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
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    expect((await readOrg(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob", "acct-cy"]);
  });

  it("apps kept apart: Mero Pixart only, and only its people", async () => {
    const { cluster, org } = await team(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(true);
    const read = await readOrg(cluster.client, org, SOURCE);
    expect(read.people).toEqual(["acct-me", "acct-bob"]);
    expect(read.appOnly).toBe(true);
    expect(read.roles.get("acct-cy")).toBe("member");
  });

  it("a legacy org: the org-wide invite, every member listed", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: people });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toBeUndefined();
    expect((await readOrg(cluster.client, org, SOURCE)).people).toHaveLength(4);
  });
});

describe("Remove and Leave", () => {
  it("apps kept apart: Remove takes the person out of Mero Pixart, never the org", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    cluster.keepAppsApart(org);
    expect(await removeTeamMember(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("app");
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
    expect((await readOrg(cluster.client, org, SOURCE)).people).not.toContain("acct-bob");
  });

  it("standalone and legacy: Remove is out of the organization, as before", async () => {
    const { cluster, org } = await team({ "acct-bob": "member" });
    expect(await removeTeamMember(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("org");
    expect(cluster.org(org).members["acct-bob"]).toBeUndefined();
    const legacy = cluster.addOrg({ mode: "legacy", members: { "acct-bob": "member" } });
    expect(await removeTeamMember(cluster.client, legacy, SOURCE, "acct-bob", passkey)).toBe("org");
  });

  it("apps kept apart: Leave is Mero Pixart only; lastApp, then the org on request", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    cluster.keepAppsApart(org);
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveTeam(cluster.client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    await leaveTeamOrg(cluster.client, org, passkey);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("standalone: Leave is leaving the organization", async () => {
    const { cluster, org } = await team({ "acct-ana": "owner" });
    expect(await leaveTeam(cluster.client, org, SOURCE, passkey)).toEqual({ left: "org", lastApp: false });
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });
});

describe("adding Mero Pixart to an organization whose apps have teams", () => {
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
    await expect(add(cluster, org)).rejects.toThrow(/owners and admins can add Mero Pixart/);
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
