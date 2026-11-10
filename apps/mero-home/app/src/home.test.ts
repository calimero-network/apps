import { describe, expect, it } from "vitest";

import {
  accessCell,
  appsOf,
  audience,
  installable,
  inviteApps,
  inviteExpiry,
  invitableApps,
  loadOrg,
  loadRosters,
  openLink,
  otherApps,
  peopleOf,
  screensFor,
  yourApps,
} from "./home";
import { BLOCKS, CHAT, CRM, ORG, fakeOrg } from "./test/fakeOrg";

async function view(opts: Parameters<typeof fakeOrg>[0] = {}) {
  const { asClient: client, me } = fakeOrg(opts);
  return { v: await loadOrg(client, ORG, me), client };
}

describe("loadOrg", () => {
  it("lists app teams by name, and a package without one as a legacy app", async () => {
    const { v } = await view();
    expect(v.mode).toBe("shared");
    expect(v.role).toBe("owner");
    expect(v.apps.map((a) => [a.name, a.team?.teamId ?? null])).toEqual([
      ["Blocks", "t-blocks"],
      ["Chat", "t-chat"],
      ["Mero Crm", null],
    ]);
    expect(v.apps.find((a) => a.package === CRM)?.instances.map((i) => i.appId)).toEqual(["crm-1"]);
  });

  it("works on a node without app teams: every app is legacy, the mode comes from getOrg", async () => {
    const { v } = await view({ noRoute: true, mode: "legacy" });
    expect(v.mode).toBe("legacy");
    expect(v.apps.every((a) => a.team === null)).toBe(true);
    expect(v.apps.map((a) => a.package).sort()).toEqual([CHAT, CRM]);
  });

  it("orders people owners first, with names from member metadata", () => {
    expect(
      peopleOf({
        members: { b: "member", a: "owner", g: "guest", x: "admin" },
        memberMetadata: { b: { name: "Bob" }, x: { name: " " } },
      }).map((p) => [p.account, p.role, p.name]),
    ).toEqual([
      ["a", "owner", null],
      ["x", "admin", null],
      ["b", "member", "Bob"],
      ["g", "guest", null],
    ]);
  });
});

describe("the owner's decisions", () => {
  it("(3) a guest is app-only: no People screen, only their apps", async () => {
    const { v } = await view({ as: "guest" });
    expect(screensFor(v)).toEqual(["apps"]);
    expect(yourApps(v).map((a) => a.package)).toEqual([CHAT]);
  });

  it("(1) shared: a plain member gets no Invitations screen until the app's switch is on", async () => {
    expect(screensFor((await view({ as: "member" })).v)).toEqual(["apps", "people"]);
    const on = (await view({ as: "member", chatInvite: true })).v;
    expect(screensFor(on)).toEqual(["apps", "people", "invitations"]);
    expect(invitableApps(on).map((a) => a.package)).toEqual([CHAT]);
  });

  it("(1) standalone: members invite to their app", async () => {
    const { v } = await view({ as: "member", mode: "standalone" });
    expect(invitableApps(v).map((a) => a.package)).toEqual([CHAT]);
  });

  it("(1) a lead invites to the app they lead, not to others", async () => {
    const { v } = await view({ as: "lead" });
    expect(screensFor(v)).toContain("invitations");
    expect(invitableApps(v).map((a) => a.package)).toEqual([CHAT]);
  });

  it("(4) only admins get the Admin screen, and invite to every app", async () => {
    const { v } = await view({ as: "admin" });
    expect(screensFor(v)).toEqual(["apps", "people", "invitations", "admin", "settings"]);
    expect(invitableApps(v).map((a) => a.package)).toEqual([BLOCKS, CHAT]);
  });

  it("an admin sees the apps they are not in, a member does not", async () => {
    expect(otherApps((await view({ as: "admin" })).v).map((a) => a.package)).toEqual([BLOCKS, CHAT]);
    expect(otherApps((await view({ as: "member" })).v)).toEqual([]);
  });
});

describe("the People matrix", () => {
  it("reads closed teams' rows; open and legacy apps are everyone's", async () => {
    const { v, client } = await view();
    const rosters = await loadRosters(client, ORG, v.apps);
    const bob = v.people.find((p) => p.account === "acct-bob")!;
    const chat = v.apps.find((a) => a.package === CHAT)!;
    const blocks = v.apps.find((a) => a.package === BLOCKS)!;
    const crm = v.apps.find((a) => a.package === CRM)!;
    expect(accessCell(v, chat, rosters, bob)).toBe("member");
    expect(accessCell(v, blocks, rosters, bob)).toBe("none");
    expect(accessCell(v, crm, rosters, bob)).toBe("all");
    // (6) removing Bob takes him out of every app he has.
    expect(appsOf(v, rosters, bob).map((a) => a.package)).toEqual([CHAT, CRM]);
  });

  it("a guest of an org with app teams has no organization-access app", async () => {
    const { v, client } = await view();
    const rosters = await loadRosters(client, ORG, v.apps);
    const gus = v.people.find((p) => p.account === "acct-gus")!;
    expect(accessCell(v, v.apps.find((a) => a.package === CRM)!, rosters, gus)).toBe("none");
  });

  it("a team the caller may not read is 'unknown', not an error", async () => {
    const { v, client } = await view({ as: "member" });
    const rosters = await loadRosters(client, ORG, v.apps);
    const ana = v.people.find((p) => p.account === "acct-ana")!;
    expect(accessCell(v, v.apps.find((a) => a.package === BLOCKS)!, rosters, ana)).toBe("unknown");
  });
});

describe("words and links", () => {
  it("opens an app at the copy its cluster serves, in the org and its team", () => {
    const url = new URL(openLink(CHAT, ORG, "t-chat"));
    expect(url.hostname.endsWith(".apps.calimero.network")).toBe(true);
    expect(url.searchParams.get("org")).toBe(ORG);
    expect(url.searchParams.get("team")).toBe("t-chat");
  });

  it("says who has an app", async () => {
    const { v } = await view();
    expect(audience(v.apps.find((a) => a.package === CHAT)!)).toBe("3 people");
    expect(audience(v.apps.find((a) => a.package === BLOCKS)!)).toBe("1 person");
    expect(audience(v.apps.find((a) => a.package === CRM)!)).toBe("Everyone in the organization");
  });

  it("names an invite's apps and its expiry", async () => {
    const { v } = await view();
    expect(inviteApps({ teams: ["t-chat", "t-blocks"] }, v)).toBe("Chat, Blocks");
    expect(inviteApps({ teams: [] }, v)).toBe("Organization only");
    expect(inviteApps({ teams: ["t-x"] }, v)).toBe("a team you do not see");
    const now = 1_700_000_000_000;
    expect(inviteExpiry({ expiresAt: now / 1000 + 3 * 86_400, expired: false }, now)).toBe("Expires in 3 days");
    expect(inviteExpiry({ expiresAt: now / 1000 + 7200, expired: false }, now)).toBe("Expires in 2 h");
    expect(inviteExpiry({ expiresAt: now / 1000 - 1, expired: false }, now)).toBe("Expired");
    expect(inviteExpiry({ expiresAt: now / 1000 + 9e6, expired: true }, now)).toBe("Expired");
  });

  it("offers to add only packages without an app team, never Home itself", async () => {
    const { v } = await view();
    expect(
      installable([{ package: CHAT }, { package: CRM }, { package: "com.calimero.mero-home" }, { package: "com.calimero.mero-sheets" }], v),
    ).toEqual([CRM, "com.calimero.mero-sheets"]);
  });
});
