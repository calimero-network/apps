/**
 * Mero Stream's own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's. Stream has no organization-level Remove
 * or Leave, so what is pinned: a new stream gets an open app team and rooms
 * go on it; invites name it; the members are its people; adding Stream to an
 * org whose apps have teams; a legacy org as before.
 */
import { describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import { orgCluster } from "@calimero-apps/connect/testing";

import { appInviteToken, createRoom, createStream, listStreams, streamInfo } from "./streams";

const PKG = "com.calimero.mero-stream";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

async function stream(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { orgId: org, warning } = await createStream(cluster.client, "Acme", passkey, SOURCE);
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new stream gets Mero Stream's own app team", () => {
  it("open (made with `shared: false`), and a room goes on it", async () => {
    const { cluster, org } = await stream();
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const room = await createRoom(cluster.client, SOURCE, org, "Standup", passkey);
    expect(cluster.state.apps.get(room)!.access).toEqual({ kind: "team", team: cluster.teamOf(org, PKG) });
  });

  it("a declined team leaves a legacy stream, whose rooms use organization access as before", async () => {
    const cluster = orgCluster();
    cluster.state.declined.add("scopeApps");
    const { orgId: org } = await createStream(cluster.client, "Acme", passkey, SOURCE);
    expect(cluster.modeOf(org)).toBe("legacy");
    await createRoom(cluster.client, SOURCE, org, "Standup", passkey);
    expect(cluster.callsOf("createApp")[0]![2]).toEqual({ org, initArgs: { name: "Standup" } });
  });
});

describe("invites and people", () => {
  const people = { "acct-bob": "member", "acct-cy": "member", "acct-gus": "guest" };

  it("standalone: the invite names the team; every member but a guest, and the count", async () => {
    const { cluster, org } = await stream(people);
    await createRoom(cluster.client, SOURCE, org, "Standup", passkey);
    expect((await appInviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    const info = await streamInfo(cluster.client, org, SOURCE);
    expect(info.members).toEqual(["acct-me", "acct-bob", "acct-cy"]);
    expect(info.appOnly).toBeUndefined();
    expect((await listStreams(cluster.client, SOURCE)).find((s) => s.orgId === org)?.memberCount).toBe(3);
  });

  it("apps kept apart: Mero Stream only, and only its people", async () => {
    const { cluster, org } = await stream(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await appInviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(true);
    const info = await streamInfo(cluster.client, org, SOURCE);
    expect(info.members).toEqual(["acct-me", "acct-bob"]);
    expect(info.appOnly).toBe(true);
  });

  it("a legacy org: the org-wide invite, every member", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: people });
    expect((await appInviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf("invite")[0]![3]).toBeUndefined();
    expect((await streamInfo(cluster.client, org, SOURCE)).members).toHaveLength(4);
  });
});

describe("adding Mero Stream to an organization whose apps have teams", () => {
  it("an admin: open in an open org, closed in one that keeps its apps apart", async () => {
    const cluster = orgCluster();
    const open = cluster.addOrg({ mode: "standalone", role: "admin" });
    await createRoom(cluster.client, SOURCE, open, "General", passkey);
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: "shared", role: "admin" });
    await createRoom(cluster.client, SOURCE, apart, "General", passkey);
    expect(cluster.callsOf("scopeApps")[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it("a member is told only owners and admins can add it, and nothing is made", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "standalone", role: "member" });
    await expect(createRoom(cluster.client, SOURCE, org, "General", passkey)).rejects.toThrow(
      /owners and admins can add Mero Stream/,
    );
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
