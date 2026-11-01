import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureInvite,
  dropInvite,
  inviteLink,
  joinedOrg,
  listForums,
  listSpaces,
  pendingInvite,
  readMembers,
} from "./spaces";
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

  it("builds a space link, and a forum link that lands in the forum", () => {
    const loc = { origin: "https://forum.example", pathname: "/0.1.0/" };
    expect(inviteLink("tok", undefined, loc)).toBe("https://forum.example/0.1.0/?invite=tok");
    expect(inviteLink("tok", "f1", loc)).toBe("https://forum.example/0.1.0/?invite=tok&forum=f1");
  });

  it("takes the token off the address bar and keeps it across the sign-up", () => {
    const storage = memoryStorage();
    window.history.replaceState(null, "", "/spaces?invite=tok&forum=f1&x=1");
    captureInvite(storage, window.location);
    expect(window.location.search).toBe("?x=1");
    expect(pendingInvite(storage)).toEqual({ token: "tok", forum: "f1" });
    dropInvite(storage);
    expect(pendingInvite(storage)).toBeNull();
  });

  it("ignores a page with no invitation", () => {
    const storage = memoryStorage();
    window.history.replaceState(null, "", "/f");
    captureInvite(storage, window.location);
    expect(pendingInvite(storage)).toBeNull();
  });

  it("finds the org a redemption joined", () => {
    expect(joinedOrg({ org: "o1" })).toBe("o1");
    expect(joinedOrg({ orgId: "o2" })).toBe("o2");
    expect(joinedOrg({})).toBeNull();
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
