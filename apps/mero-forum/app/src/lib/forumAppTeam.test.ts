/**
 * Mero Forum's own app team (core#4890), against the shared in-memory cluster
 * (`@calimero-apps/connect/testing`), the way mero-chat's `chatAppTeam.test.ts`
 * pins Chat's. Forum has no member Remove (only Leave), so what is pinned: a
 * new space gets an open team and its forums go on it; invites name it; the
 * member count is its people; Leave in an org that keeps its apps apart is
 * Forum only; adding Forum to an org whose apps have teams; a legacy org.
 */
import { describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import { orgCluster } from "@calimero-apps/connect/testing";

import { createForum, createSpace, inviteToken, leaveSpace, leaveSpaceOrg, readMembers } from "./spaces";

const PKG = "com.calimero.mero-forum";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

async function space(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { namespaceId: org, warning } = await createSpace(cluster.client, "Acme", passkey, undefined, SOURCE);
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new space gets Forum's own app team", () => {
  it("open (made with `shared: false`), and a forum goes on it", async () => {
    const { cluster, org } = await space();
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const forum = await createForum(cluster.client, SOURCE, org, "General", passkey);
    expect(cluster.state.apps.get(forum)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("a declined team leaves a legacy space, whose forums use organization access as before", async () => {
    const cluster = orgCluster();
    cluster.state.declined.add("scopeApps");
    const { namespaceId: org } = await createSpace(cluster.client, "Acme", passkey, undefined, SOURCE);
    expect(cluster.modeOf(org)).toBe("legacy");
    await createForum(cluster.client, SOURCE, org, "General", passkey);
    expect(cluster.callsOf("createApp")[0]![2]).toEqual({ org });
  });
});

describe("invites and people", () => {
  it("standalone: the invite names the team; every member but a guest is counted", async () => {
    const { cluster, org } = await space({ "acct-bob": "member", "acct-gus": "guest" });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob"]);
  });

  it("apps kept apart: Forum only, and only its people", async () => {
    const { cluster, org } = await space({ "acct-bob": "member", "acct-cy": "member" });
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(true);
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob"]);
  });

  it("a legacy org: the org-wide invite, every member counted", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: { "acct-gus": "guest" } });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toBeUndefined();
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-gus"]);
  });
});

describe("Leave", () => {
  it("apps kept apart: Forum only, never the org; lastApp when it was the last app, then the org on request", async () => {
    const { cluster, org } = await space({ "acct-ana": "owner" });
    cluster.keepAppsApart(org);
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveSpace(cluster.client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    await leaveSpaceOrg(cluster.client, org, passkey);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("standalone and legacy: leaving the space is leaving the organization, as before", async () => {
    const { cluster, org } = await space({ "acct-ana": "owner" });
    expect(await leaveSpace(cluster.client, org, SOURCE, passkey)).toEqual({ left: "org", lastApp: false });
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
    const legacy = cluster.addOrg({ mode: "legacy", role: "member" });
    expect((await leaveSpace(cluster.client, legacy, SOURCE, passkey)).left).toBe("org");
  });
});

describe("adding Forum to an organization whose apps have teams", () => {
  it("an admin: open in an open org, closed in one that keeps its apps apart", async () => {
    const cluster = orgCluster();
    const open = cluster.addOrg({ mode: "standalone", role: "admin" });
    await createForum(cluster.client, SOURCE, open, "General", passkey);
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: "shared", role: "admin" });
    await createForum(cluster.client, SOURCE, apart, "General", passkey);
    expect(cluster.callsOf("scopeApps")[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it("a member is told only owners and admins can add it, and nothing is made", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "standalone", role: "member" });
    await expect(createForum(cluster.client, SOURCE, org, "General", passkey)).rejects.toThrow(
      /owners and admins can add Mero Forum/,
    );
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
