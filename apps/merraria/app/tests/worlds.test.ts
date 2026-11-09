import { describe, expect, it, vi } from "vitest";

import {
  captureInvite,
  createWorld,
  dropInvite,
  inviteLink,
  listWorlds,
  pendingInvite,
  pendingInviteOrg,
  readCurrentWorld,
  writeCurrentWorld,
} from "../src/net/worlds";

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
    expect(await listWorlds({ listApps }, "bundle-hash")).toEqual([
      { appId: "1", name: "alpha", org: null },
      { appId: "2", name: "beta", org: "org" },
    ]);
    expect(listApps).toHaveBeenLastCalledWith({ bundle: "bundle-hash" });
    await listWorlds({ listApps }, { package: "com.calimero.merraria" });
    expect(listApps).toHaveBeenLastCalledWith({ package: "com.calimero.merraria" });
  });
});

describe("createWorld", () => {
  it("makes an org, the instance in it, then founds the world with its name and seed", async () => {
    const order: string[] = [];
    const client = {
      createOrg: vi.fn(async () => (order.push("org"), "org-1")),
      createApp: vi.fn(async () => (order.push("app"), "app-1")),
      call: vi.fn(async (_a: string, method: string, _args?: unknown) => (order.push(method), { index: 1, result: null, events: [] })),
      view: vi.fn(),
    };
    const world = await createWorld(client, "bundle", "surface", 42);
    expect(world).toEqual({ appId: "app-1", name: "surface", org: "org-1" });
    expect(order).toEqual(["org", "app", "createWorld"]);
    expect(client.createApp).toHaveBeenCalledWith("surface", "bundle", { org: "org-1" });
    expect(client.call.mock.calls[0][2]).toMatchObject({ name: "surface", seed: 42 });
  });
});

describe("invitations", () => {
  it("links to this frontend with the token", () => {
    expect(inviteLink("tok", { origin: "https://x.example", pathname: "/1.0.0/" })).toBe(
      "https://x.example/1.0.0/?invite=tok",
    );
    expect(inviteLink("tok", { origin: "https://x.example", pathname: "/1.0.0/" }, "org-1")).toBe(
      "https://x.example/1.0.0/?invite=tok&org=org-1",
    );
  });

  it("captures ?invite= into storage and off the address bar", () => {
    const storage = memory();
    window.history.replaceState(null, "", "/?invite=tok-1&org=org-1&x=1");
    captureInvite(storage, window.location);
    expect(pendingInvite(storage)).toBe("tok-1");
    expect(pendingInviteOrg(storage)).toBe("org-1");
    expect(window.location.search).toBe("?x=1");
    dropInvite(storage);
    expect(pendingInvite(storage)).toBeNull();
    expect(pendingInviteOrg(storage)).toBeNull();
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
