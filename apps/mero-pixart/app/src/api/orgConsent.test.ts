/**
 * A team's organization-wide changes: on a session bound to the app's
 * frontend they go to the node's consent page (and nothing is called
 * directly); unbound, the app calls the routes itself. Removing and leaving
 * take a row off Hyperfeed Pixart's own team wherever the org has one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import { orgCluster } from "@calimero-apps/connect/testing";

vi.mock("@calimero-apps/passkey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-apps/passkey")>()),
  confirmConsentHandoff: vi.fn(async () => true),
}));

import { confirmConsentHandoff } from "@calimero-apps/passkey";
import {
  ORG_INTENT_KEY,
  StayedHere,
  deleteTeam,
  leaveAppTeam,
  orgIntent,
  removeFromTeam,
  returnFromOrgConsent,
  returnMessage,
  setTeamRole,
} from "./orgConsent";
import { createProject, finishTeam } from "./teams";

const PKG = "com.calimero.mero-pixart";
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

async function team(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { orgId } = await cluster.client.orgs.create({ name: "Acme" });
  const { groupId: org } = await finishTeam(cluster.client, orgId, passkey, SOURCE);
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

/** The cluster's client as a session bound to Hyperfeed Pixart's frontend sees it. */
function bound(client: ReturnType<typeof orgCluster>["client"]) {
  const openConsentPage = vi.fn(async (_request: unknown, options?: { confirm?: (s: { code: string }) => unknown }) => {
    await options?.confirm?.({ code: "K7Q2" });
    return { requestId: "r1", code: "K7Q2" };
  });
  return {
    client: Object.assign(Object.create(client) as typeof client, {
      auth: { me: async () => ({ app: PKG }) },
      openConsentPage,
    }),
    openConsentPage,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(confirmConsentHandoff).mockResolvedValue(true);
});

describe("org roles and deleting a team", () => {
  it("unbound: the role is set directly", async () => {
    const { cluster, org } = await team({ bob: "member" });
    await setTeamRole(cluster.client as never, org, "bob", "admin", passkey);
    expect(cluster.callsOf("setMember")[0]!.slice(0, 3)).toEqual([org, "bob", "admin"]);
  });

  it("bound: the role goes to the consent page, and nothing is called directly", async () => {
    const { cluster, org } = await team({ bob: "member" });
    const { client, openConsentPage } = bound(cluster.client);
    void setTeamRole(client as never, org, "bob", "admin", passkey);
    await tick();
    expect(openConsentPage).toHaveBeenCalledOnce();
    expect(openConsentPage.mock.calls[0]![0]).toMatchObject({
      kind: "setMemberRole",
      subject: { org, account: "bob", role: "admin" },
    });
    expect(orgIntent()).toEqual({ kind: "setMemberRole", org, account: "bob", role: "admin" });
    expect(cluster.callsOf("setMember")).toEqual([]);
  });

  it("bound: the consent page sends the person back to the page they asked from", async () => {
    window.history.replaceState(null, "", "/0.1.0/teams?tab=1");
    const { cluster, org } = await team({ bob: "member" });
    const { client, openConsentPage } = bound(cluster.client);
    void setTeamRole(client as never, org, "bob", "admin", passkey);
    await tick();
    expect(openConsentPage.mock.calls[0]![0]).toMatchObject({ returnTo: `${window.location.origin}/0.1.0/teams?tab=1` });
    window.history.replaceState(null, "", "/");
  });

  it("bound: deleting the team goes to the consent page", async () => {
    const { cluster, org } = await team();
    const { client, openConsentPage } = bound(cluster.client);
    void deleteTeam(client as never, org, passkey);
    await tick();
    expect(openConsentPage.mock.calls[0]![0]).toMatchObject({ kind: "deleteOrg", subject: { org } });
    expect(cluster.state.orgs.has(org)).toBe(true);
  });

  it("staying on the app changes nothing and forgets the intent", async () => {
    vi.mocked(confirmConsentHandoff).mockResolvedValue(false);
    const { cluster, org } = await team();
    const { client } = bound(cluster.client);
    await expect(deleteTeam(client as never, org, passkey)).rejects.toBeInstanceOf(StayedHere);
    expect(sessionStorage.getItem(ORG_INTENT_KEY)).toBeNull();
  });
});

describe("remove and leave on Hyperfeed Pixart's own team", () => {
  it("removing takes them off the app team and leaves them in the organization", async () => {
    const { cluster, org } = await team({ bob: "member" });
    await createProject(cluster.client, SOURCE, org, { name: "Doc", description: "", width: 1, height: 1 }, passkey);
    const { client, openConsentPage } = bound(cluster.client);
    expect(await removeFromTeam(client as never, org, SOURCE, "bob", passkey)).toBe("app");
    expect(cluster.callsOf("removeTeamMember")).toHaveLength(1);
    expect(cluster.callsOf("removeMember")).toEqual([]);
    expect(openConsentPage).not.toHaveBeenCalled();
    expect(cluster.org(org).members.bob).toBe("member");
  });

  it("leaving takes the account off the app team; its last app offers the organization", async () => {
    const { cluster, org } = await team();
    const left = await leaveAppTeam(cluster.client as never, org, SOURCE, passkey, "acct-me");
    expect(left).toEqual({ left: "app", lastApp: true });
    expect(cluster.callsOf("removeMember")).toEqual([]);
  });
});

describe("the consent page's return", () => {
  it("reads the decision from the node with the intent kept here", async () => {
    sessionStorage.setItem(ORG_INTENT_KEY, JSON.stringify({ kind: "deleteOrg", org: "o1" }));
    const resumeConsent = vi.fn(async () => ({ requestId: "r1", kind: "deleteOrg", status: "approved" }));
    const back = await returnFromOrgConsent({ resumeConsent } as never, "https://x/?request_id=r1&result=approved");
    expect(back).toEqual({ kind: "deleted", org: "o1" });
    expect(orgIntent()).toBeNull();
    expect(returnMessage(back!)).toEqual(["Team deleted.", "success"]);
  });

  it("a declined request says nothing was changed", async () => {
    sessionStorage.setItem(ORG_INTENT_KEY, JSON.stringify({ kind: "setMemberRole", org: "o1", account: "b", role: "admin" }));
    const resumeConsent = vi.fn(async () => ({ requestId: "r1", kind: "setMemberRole", status: "declined" }));
    expect(await returnFromOrgConsent({ resumeConsent } as never, "https://x/")).toEqual({ kind: "declined" });
  });
});
