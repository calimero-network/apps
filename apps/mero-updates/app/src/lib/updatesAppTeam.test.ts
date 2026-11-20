/**
 * Hyperfeed Updates' own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's: a new company gets an open app team and
 * audiences go on it; invites name it; the members are its people; Remove
 * and Leave in an org that keeps its apps apart are Updates only; adding
 * Updates to an org whose apps have teams; a legacy org as before.
 */
import { describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";
import { orgCluster } from "@calimero-apps/connect/testing";

import {
  createAudience,
  finishCompany,
  leaveCompany,
  leaveCompanyOrg,
  inviteBase,
  readCompany,
  removeFromCompany,
} from "./companies";

const PKG = "com.calimero.mero-updates";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

/** An org as the node's consent page makes it, then what the app does after. */
async function createCompany(client: ReturnType<typeof orgCluster>["client"], name: string, passkey: () => PasskeyProvider, source?: AppSource) {
  const { orgId } = await client.orgs.create({ name });
  return finishCompany(client, orgId, passkey, source);
}

async function company(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { namespaceId: org, warning } = await createCompany(cluster.client, "Acme", passkey, SOURCE);
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new company gets Hyperfeed Updates' own app team", () => {
  it("open (made with `shared: false`), and an audience goes on it", async () => {
    const { cluster, org } = await company();
    expect(cluster.modeOf(org)).toBe("standalone");
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const audience = await createAudience(cluster.client, SOURCE, org, "Everyone", passkey);
    expect(cluster.state.apps.get(audience)!.grants).toEqual([{ kind: "team", team: cluster.teamOf(org, PKG) }]);
  });

  it("a declined team leaves a legacy company, whose audiences use organization access as before", async () => {
    const cluster = orgCluster();
    cluster.state.declined.add("scopeApps");
    const { namespaceId: org } = await createCompany(cluster.client, "Acme", passkey, SOURCE);
    expect(cluster.modeOf(org)).toBe("legacy");
    await createAudience(cluster.client, SOURCE, org, "Everyone", passkey);
    expect(cluster.callsOf("createApp")[0]![2]).toEqual({ org });
  });
});

describe("invites and people", () => {
  const people = { "acct-bob": "member", "acct-cy": "member", "acct-gus": "guest" };

  it("standalone: the invite names the team; every member but a guest", async () => {
    const { cluster, org } = await company(people);
    expect((await readCompany(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob", "acct-cy"]);
  });

  it("apps kept apart: Hyperfeed Updates only, and only its people", async () => {
    const { cluster, org } = await company(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ["acct-me", "acct-bob"] });
    expect((await readCompany(cluster.client, org, SOURCE)).people).toEqual(["acct-me", "acct-bob"]);
  });

  it("a legacy org: the org-wide invite, every member", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: people });
    expect((await readCompany(cluster.client, org, SOURCE)).people).toHaveLength(4);
  });
});

describe("invite link and team edge cases", () => {
  it("the link opens the root, naming the company and the audience, with no token", () => {
    const base = new URL(inviteBase("org-1", "aud-9", { href: "http://localhost:5173/companies?x=1#frag" }));
    expect(base.origin + base.pathname).toBe("http://localhost:5173/");
    expect(Object.fromEntries(base.searchParams)).toEqual({ org: "org-1", audience: "aud-9" });
  });
});

describe("Leave", () => {
  it("apps kept apart: Hyperfeed Updates only, never the org; lastApp, then the org on request", async () => {
    const { cluster, org } = await company({ "acct-ana": "owner" });
    cluster.keepAppsApart(org);
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveCompany(cluster.client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(cluster.org(org).members["acct-me"]).toBe("member");
    await leaveCompanyOrg(cluster.client, org, passkey);
    expect(cluster.org(org).members["acct-me"]).toBeUndefined();
  });

  it("standalone: off Hyperfeed Updates' team, the organization's app, so leaving the organization is offered", async () => {
    const { cluster, org } = await company({ "acct-ana": "owner" });
    cluster.org(org).members["acct-me"] = "member";
    expect(await leaveCompany(cluster.client, org, SOURCE, passkey)).toEqual({ left: "app", lastApp: true });
    expect(cluster.callsOf("removeTeamMember")[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), "acct-me"]);
    expect(cluster.org(org).members["acct-me"]).toBe("member");
  });

  it("a company without Hyperfeed Updates' team (legacy): leaving the organization, as before", async () => {
    const cluster = orgCluster();
    const legacy = cluster.addOrg({ mode: "legacy", role: "member" });
    expect(await leaveCompany(cluster.client, legacy, SOURCE, passkey)).toEqual({ left: "org", lastApp: false });
    expect(cluster.org(legacy).members["acct-me"]).toBeUndefined();
  });
});

describe("Remove", () => {
  it("apps kept apart: off Hyperfeed Updates' team only, never out of the organization", async () => {
    const { cluster, org } = await company({ "acct-bob": "member" });
    cluster.keepAppsApart(org);
    expect(await removeFromCompany(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("app");
    expect(cluster.callsOf("removeTeamMember")[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), "acct-bob"]);
    expect(cluster.callsOf("removeMember")).toEqual([]);
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
    expect((await readCompany(cluster.client, org, SOURCE)).people).not.toContain("acct-bob");
  });

  it("standalone: off Hyperfeed Updates' team, a team call; they stay in the organization", async () => {
    const { cluster, org } = await company({ "acct-bob": "member" });
    expect(await removeFromCompany(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("app");
    expect(cluster.callsOf("removeTeamMember")[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), "acct-bob"]);
    expect(cluster.callsOf("removeMember")).toEqual([]);
    expect(cluster.org(org).members["acct-bob"]).toBe("member");
  });

  it("a legacy org: out of the organization", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "legacy", members: { "acct-bob": "member" } });
    expect(await removeFromCompany(cluster.client, org, SOURCE, "acct-bob", passkey)).toBe("org");
    expect(cluster.org(org).members["acct-bob"]).toBeUndefined();
  });
});

describe("adding Hyperfeed Updates to an organization whose apps have teams", () => {
  it("an admin: open in an open org, closed in one that keeps its apps apart", async () => {
    const cluster = orgCluster();
    const open = cluster.addOrg({ mode: "standalone", role: "admin" });
    await createAudience(cluster.client, SOURCE, open, "Everyone", passkey);
    expect(cluster.callsOf("scopeApps")[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: "shared", role: "admin" });
    await createAudience(cluster.client, SOURCE, apart, "Everyone", passkey);
    expect(cluster.callsOf("scopeApps")[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it("a member is told only owners and admins can add it, and nothing is made", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: "standalone", role: "member" });
    await expect(createAudience(cluster.client, SOURCE, org, "Everyone", passkey)).rejects.toThrow(
      /owners and admins can add Hyperfeed Updates/,
    );
    expect(cluster.callsOf("createApp")).toEqual([]);
  });
});
