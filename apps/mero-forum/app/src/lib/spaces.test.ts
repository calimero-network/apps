import { afterEach, describe, expect, it, vi } from "vitest";

import { createSpace, inviteForum, inviteLink, invites, listForums, listSpaces, migrateLegacyInvite, readMembers } from "./spaces";
import { decideStoredForum } from "./storedForum";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const APPS = [
  { appId: "f2", name: "Zeta", owner: "ana", org: "o1", bundle: "b", package: null, version: null },
  { appId: "f1", name: "Alpha", owner: "bob", org: "o1", bundle: "b", package: null, version: null },
  { appId: "f3", name: "Other", owner: "ana", org: "o2", bundle: "b", package: null, version: null },
  { appId: "f4", name: "Personal", owner: "ana", org: null, bundle: "b", package: null, version: null },
];

describe("spaces and forums", () => {
  it("lists the account's orgs with their forum and member counts", async () => {
    const client = {
      me: vi.fn().mockResolvedValue({
        orgs: [
          { orgId: "o2", name: "Beta", role: "member" },
          { orgId: "o1", name: "Alpha", role: "owner" },
        ],
      }),
      listApps: vi.fn().mockResolvedValue(APPS),
      getOrg: vi.fn(async (org: string) => ({
        name: org,
        members: org === "o1" ? { ana: "owner", bob: "member" } : { ana: "member" },
      })),
    };
    const rows = await listSpaces(client as never, "bundle-hash");
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect(rows).toEqual([
      { namespaceId: "o1", name: "Alpha", role: "owner", forumCount: 2, memberCount: 2 },
      { namespaceId: "o2", name: "Beta", role: "member", forumCount: 1, memberCount: 1 },
    ]);
  });

  it("lists one org's forums by name, from the package in production", async () => {
    const client = { listApps: vi.fn().mockResolvedValue(APPS) };
    const rows = await listForums(client as never, { package: "com.calimero.mero-forum" }, "o1");
    expect(client.listApps).toHaveBeenCalledWith({ package: "com.calimero.mero-forum" });
    expect(rows.map((r) => [r.name, r.forumId, r.owner])).toEqual([
      ["Alpha", "f1", "bob"],
      ["Zeta", "f2", "ana"],
    ]);
  });

  it("reads names from member metadata", async () => {
    const client = {
      getOrg: vi.fn().mockResolvedValue({
        name: "S",
        members: { a: "owner", b: "guest" },
        memberMetadata: { a: { name: " Ana " }, b: { name: "" }, c: null },
      }),
    };
    const m = await readMembers(client as never, "o1");
    expect([...m.roles]).toEqual([
      ["a", "owner"],
      ["b", "guest"],
    ]);
    expect([...m.names]).toEqual([["a", "Ana"]]);
  });
});

describe("invitations", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("builds a space link, and a forum link that lands in the forum, under the served version root", () => {
    const loc = { href: `https://${"a".repeat(52)}.apps.calimero.network/0.1.0/spaces/org-1` };
    const root = `https://${"a".repeat(52)}.apps.calimero.network/0.1.0/`;
    expect(inviteLink("tok", undefined, loc)).toBe(`${root}?invite=tok`);
    expect(inviteLink("tok", "f1", loc)).toBe(`${root}?invite=tok&forum=f1`);
    // The space it is for, so a member is not asked to spend it.
    expect(inviteLink("tok", "f1", loc, "org-1")).toBe(`${root}?invite=tok&org=org-1&forum=f1`);
  });

  it("takes the token off the address bar and keeps it across the sign-up", () => {
    window.history.replaceState(null, "", "/spaces?invite=tok&forum=f1&x=1");
    invites.capture(window.location);
    expect(window.location.search).toBe("?x=1");
    expect(invites.token()).toBe("tok");
    expect(inviteForum(invites.pending())).toBe("f1");
    expect(invites.pending()?.route).toBe("/spaces");
    invites.drop();
    expect(invites.pending()).toBeNull();
  });

  it("keeps the space and the route under the node basename", () => {
    window.history.replaceState(null, "", "/0.1.0/p/post-1?invite=tok&org=org-1");
    invites.capture(window.location, { basename: "/0.1.0/" });
    expect(window.location.search).toBe("");
    expect(invites.pending()).toMatchObject({ token: "tok", org: "org-1", route: "/p/post-1", extra: {} });
    invites.drop();
  });

  it("moves an invite an earlier build stored under its own key into the shared store", () => {
    const storage = memoryStorage();
    storage.setItem("mero-forum:pending-invite", JSON.stringify({ token: "old", forum: "f1", org: "o1", route: "/f" }));
    migrateLegacyInvite(storage);
    expect(invites.pending()).toMatchObject({ token: "old", org: "o1", route: "/f", extra: { forum: "f1" } });
    expect(storage.getItem("mero-forum:pending-invite")).toBeNull();
    invites.drop();
  });
});

describe("the remembered forum", () => {
  it("opens only once the cluster lists it", () => {
    expect(decideStoredForum(null, null)).toBe("none");
    expect(decideStoredForum("f1", null)).toBe("checking");
    expect(decideStoredForum("f1", ["f1", "f2"])).toBe("open");
    expect(decideStoredForum("gone", ["f1"])).toBe("none");
  });
});

describe("an org made for another app", () => {
  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  function client(metadata: Record<string, unknown> = {}) {
    const blocks = { appId: "w1", name: "overworld", owner: "ana", org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks", version: null };
    return {
      me: vi.fn().mockResolvedValue({
        orgs: [
          { orgId: "ow", name: "overworld", role: "owner" },
          { orgId: "o1", name: "Alpha", role: "owner" },
          { orgId: "new", name: "Fresh", role: "owner" },
        ],
      }),
      listApps: vi.fn(async (f?: { bundle?: string }) => [...APPS, blocks].filter((a) => !f?.bundle || a.bundle === f.bundle)),
      getOrg: vi.fn(async (org: string) => ({ name: org, members: { ana: "owner" }, metadata: metadata[org] ?? null })),
      createOrg: vi.fn(async () => "new"),
      setCapabilities: vi.fn(async () => {}),
      setOrgMetadata: vi.fn(async (org: string, m: unknown) => {
        metadata[org] = m;
      }),
    };
  }

  it("is not a space; a space made here is, before it holds a forum", async () => {
    const c = client();
    expect((await listSpaces(c as never, "b")).map((r) => r.namespaceId)).toEqual(["o1"]);
    await createSpace(c as never, "Fresh", () => ({}) as never, () => {}, "b");
    expect((await listSpaces(c as never, "b")).map((r) => r.namespaceId)).toEqual(["o1", "new"]);
  });
});
