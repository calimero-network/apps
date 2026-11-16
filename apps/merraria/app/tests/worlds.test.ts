import { describe, expect, it, vi } from "vitest";

import { createInviteStore, type InviteStore } from "@calimero-apps/connect";

import {
  createWorld,
  invitedWorld,
  listWorlds,
  migrateStoredInvite,
  readCurrentWorld,
  worldLinkBase,
  writeCurrentWorld,
} from "../src/net/worlds";
import { withRoutes } from "@calimero-apps/connect/testing";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const app = (appId: string, name: string, org: string | null = null) => ({
  appId,
  name,
  org,
  owner: "o",
  bundle: "b",
  package: null,
  version: null,
});

describe("listWorlds", () => {
  it("lists by bundle in dev and by package in production, by name", async () => {
    const listApps = vi.fn().mockResolvedValue([app("2", "beta", "org"), app("1", "alpha")]);
    expect(await listWorlds(withRoutes({ listApps }), "bundle-hash")).toEqual([
      { appId: "1", name: "alpha", org: null },
      { appId: "2", name: "beta", org: "org" },
    ]);
    expect(listApps).toHaveBeenLastCalledWith({ bundle: "bundle-hash" });
    await listWorlds(withRoutes({ listApps }), { package: "com.calimero.merraria" });
    expect(listApps).toHaveBeenLastCalledWith({ package: "com.calimero.merraria" });
  });
});

describe("createWorld", () => {
  it("makes the instance in the given org, then founds the world with its name and seed", async () => {
    const order: string[] = [];
    const client = {
      createApp: vi.fn(async () => (order.push("app"), "app-1")),
      call: vi.fn(async (_a: string, method: string, _args?: unknown) => (order.push(method), { index: 1, result: null, events: [] })),
      view: vi.fn(),
    };
    const world = await createWorld(withRoutes(client), "bundle", "surface", 42, "org-1");
    expect(world).toEqual({ appId: "app-1", name: "surface", org: "org-1" });
    expect(order).toEqual(["app", "createWorld"]);
    expect(client.createApp).toHaveBeenCalledWith("surface", "bundle", { org: "org-1" });
    expect(client.call.mock.calls[0][2]).toMatchObject({ name: "surface", seed: 42 });
  });
});

describe("invitations", () => {
  function store(storage = memory()): InviteStore {
    return createInviteStore("merraria", { storage, keep: ["world"] });
  }
  function holding(token: string, org: string | null = null, extra: Record<string, string> = {}): InviteStore {
    const s = store();
    s.put({ token, org, team: null, doc: null, route: null, extra });
    return s;
  }

  it("link to a page naming the org and the world, and are captured before sign-in", () => {
    const base = new URL(worldLinkBase("org-1", "w-1"));
    expect(base.origin + base.pathname).toBe(`${window.location.origin}/`);
    expect(base.searchParams.get("org")).toBe("org-1");
    expect(base.searchParams.get("world")).toBe("w-1");
    expect(base.searchParams.has("from")).toBe(false);
    expect(new URL(worldLinkBase("org-1", "w-1", "Ada")).searchParams.get("from")).toBe("Ada");
    // The shared dialog puts the token in the fragment.
    const s = store();
    window.history.replaceState(null, "", "/?org=org-1&world=w-1&x=1#invite=tok-1");
    s.capture(window.location);
    expect(s.pending()).toMatchObject({ token: "tok-1", org: "org-1" });
    expect(invitedWorld(s.pending())).toBe("w-1");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("");
  });

  it("stored by an older build move into the shared store", () => {
    const storage = memory();
    storage.setItem("merraria:pending-invite", "tok-old");
    storage.setItem("merraria:pending-invite-org", "org-2");
    const s = store(storage);
    migrateStoredInvite(s, storage);
    expect(s.pending()).toMatchObject({ token: "tok-old", org: "org-2" });
    expect(storage.getItem("merraria:pending-invite")).toBeNull();
    expect(storage.getItem("merraria:pending-invite-org")).toBeNull();

    const fresh = holding("tok-new");
    const old = memory();
    old.setItem("merraria:pending-invite", "tok-old");
    migrateStoredInvite(fresh, old);
    expect(fresh.token()).toBe("tok-new");
  });
});

describe("the world last played", () => {
  it("round-trips, and reads nothing without a key or from garbage", () => {
    const storage = memory();
    writeCurrentWorld(storage, "k", { appId: "a", name: "n", org: "o" });
    expect(readCurrentWorld(storage, "k")).toEqual({ appId: "a", name: "n", org: "o" });
    expect(readCurrentWorld(storage, null)).toBeNull();
    storage.setItem("k", "{");
    expect(readCurrentWorld(storage, "k")).toBeNull();
    writeCurrentWorld(storage, "k", null);
    expect(storage.getItem("k")).toBeNull();
  });
});
