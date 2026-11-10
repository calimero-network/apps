/**
 * Mero Forms' own app team (core#4890), against the shared in-memory cluster
 * (`@calimero-apps/connect/testing`), the way mero-chat's `chatAppTeam.test.ts`
 * pins Chat's. Forms has no org-level Remove or Leave (its team is the
 * contract's), so what is pinned: a new org gets an open team and the
 * workspace goes on it; invites name it; the people offered are its people;
 * adding Forms to an org whose apps have teams; a legacy org as before.
 */
import { describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import { orgCluster } from "@calimero-apps/connect/testing";

import { createWorkspace, inviteToken, readMembers } from "./orgs";

const PKG = "com.calimero.mero-forms";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

describe("a new workspace in a new org", () => {
  it("gets Forms' open team (made with `shared: false`), and the workspace is on it", async () => {
    const cluster = orgCluster();
    const { appId, org } = await createWorkspace(cluster.client, SOURCE, "Sales", null, passkey);
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    expect(cluster.state.apps.get(appId)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("a declined team leaves a legacy org, whose workspace uses organization access as before", async () => {
    const cluster = orgCluster();
    cluster.state.declined.add("scopeApps");
    const { org } = await createWorkspace(cluster.client, SOURCE, "Sales", null, passkey);
    expect(cluster.modeOf(org)).toBe("legacy");
    expect(cluster.callsOf("createApp")[0]![2]).toEqual({ org });
  });

  it("a raw dev bundle has no package: no team is asked for", async () => {
    const cluster = orgCluster();
    await createWorkspace(cluster.client, "bundle-hash", "Sales", null, passkey);
    expect(cluster.callsOf("scopeApps")).toEqual([]);
  });
});

describe("invites and people", () => {
  it("standalone: the invite names the team; everyone but a guest is offered", async () => {
    const cluster = orgCluster();
    const { org } = await createWorkspace(cluster.client, SOURCE, "Sales", null, passkey);
    Object.assign(cluster.org(org).members, { "acct-bob": "member", "acct-gus": "guest" });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob"]);
  });

  it("apps kept apart: the invite gives Mero Forms only; only its people are offered", async () => {
    const cluster = orgCluster();
    const { org } = await createWorkspace(cluster.client, SOURCE, "Sales", null, passkey);
    Object.assign(cluster.org(org).members, { "acct-bob": "member", "acct-cy": "member" });
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(true);
    const read = await readMembers(cluster.client, org, SOURCE);
    expect(read.people).toEqual(["acct-me", "acct-bob"]);
    expect(read.appOnly).toBe(true);
  });

  it("a legacy org: the org-wide invite, and every member offered, the guest too", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: { "acct-gus": "guest" } });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toBeUndefined();
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-gus"]);
  });
});

describe("adding Forms to an organization whose apps have teams", () => {
  it("an admin of an open org: Forms' team is made open", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "standalone", role: "admin" });
    const { appId } = await createWorkspace(cluster.client, SOURCE, "Sales", org, passkey);
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    expect(cluster.state.apps.get(appId)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("an admin of an org that keeps its apps apart: made closed", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "shared", role: "admin" });
    await createWorkspace(cluster.client, SOURCE, "Sales", org, passkey);
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it("a member is told only owners and admins can add it, and nothing is made", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "standalone", role: "member" });
    await expect(createWorkspace(cluster.client, SOURCE, "Sales", org, passkey)).rejects.toThrow(
      /owners and admins can add Mero Forms/,
    );
    expect(cluster.callsOf("createApp")).toEqual([]);
  });

  it("a legacy org keeps organization access", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy" });
    await createWorkspace(cluster.client, SOURCE, "Sales", org, passkey);
    expect(cluster.callsOf("scopeApps")).toEqual([]);
    expect(cluster.callsOf("createApp")[0]![2]).toEqual({ org });
  });
});
