import { describe, expect, it, vi } from "vitest";

import { CalimeroError, type AppInfo } from "@calimero-network/mero-js";
import { createInviteStore, type InviteStore } from "@calimero-apps/connect";

import {
  alreadyInInvitedWorld,
  createWorld,
  invitedWorld,
  inviter,
  listWorlds,
  migrateStoredInvite,
  readCurrentWorld,
  redeemPendingInvite,
  worldInviteLink,
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
  it("makes an org, the instance in it, then founds the world with its name and seed", async () => {
    const order: string[] = [];
    const client = {
      createOrg: vi.fn(async () => (order.push("org"), "org-1")),
      createApp: vi.fn(async () => (order.push("app"), "app-1")),
      call: vi.fn(async (_a: string, method: string, _args?: unknown) => (order.push(method), { index: 1, result: null, events: [] })),
      view: vi.fn(),
    };
    const world = await createWorld(withRoutes(client), "bundle", "surface", 42);
    expect(world).toEqual({ appId: "app-1", name: "surface", org: "org-1" });
    expect(order).toEqual(["org", "app", "createWorld"]);
    expect(client.createApp).toHaveBeenCalledWith("surface", "bundle", { org: "org-1" });
    expect(client.call.mock.calls[0][2]).toMatchObject({ name: "surface", seed: 42 });
  });
});

describe("invitations", () => {
  function store(storage = memory()): InviteStore {
    return createInviteStore("merraria", { storage, keep: ["world", "from"] });
  }
  function holding(token: string, org: string | null = null, extra: Record<string, string> = {}): InviteStore {
    const s = store();
    s.put({ token, org, team: null, doc: null, route: null, extra });
    return s;
  }

  it("link to this frontend with the token, the org, the world and the inviter", () => {
    expect(worldInviteLink("tok", "org-1", { world: "w-1", from: "Ada", root: "/1.0.0/" })).toBe(
      `${window.location.origin}/1.0.0/?invite=tok&org=org-1&world=w-1&from=Ada`,
    );
  });

  it("are captured into the shared store and off the address bar", () => {
    const s = store();
    window.history.replaceState(null, "", "/?invite=tok-1&org=org-1&world=w-1&from=Ada&x=1");
    s.capture(window.location);
    expect(s.pending()).toMatchObject({ token: "tok-1", org: "org-1" });
    expect(invitedWorld(s.pending())).toBe("w-1");
    expect(inviter(s.pending())).toBe("Ada");
    expect(window.location.search).toBe("?x=1");
  });

  it("are redeemed on Join, opening the world the link named, else the one in the joined org", async () => {
    const client = {
      redeemInvite: vi.fn(async () => ({ org: "org-2" })),
      listApps: vi.fn(async () => [app("1", "a", "org-1"), app("2", "b", "org-2"), app("3", "c", "org-2")] as AppInfo[]),
    };
    const s = holding("tok1");
    expect((await redeemPendingInvite(withRoutes(client), "abc", s))?.appId).toBe("2");
    expect(s.token()).toBeNull();
    expect((await redeemPendingInvite(withRoutes(client), "abc", holding("tok2", "org-2", { world: "3" })))?.appId).toBe("3");
  });

  it("are not spent by a player already in the world they name", async () => {
    const listApps = vi.fn(async () => [app("1", "a", "org-1")] as AppInfo[]);
    const mine = holding("tok1", "org-1");
    expect((await alreadyInInvitedWorld(withRoutes({ listApps }), "abc", mine))?.appId).toBe("1");
    expect(mine.token()).toBeNull();
    const theirs = holding("tok2", "org-9");
    expect(await alreadyInInvitedWorld(withRoutes({ listApps }), "abc", theirs)).toBeNull();
    expect(theirs.token()).toBe("tok2");
  });

  it("drop a token only when the node refuses it for good", async () => {
    const refusing = (e: unknown) => ({ redeemInvite: vi.fn(async () => Promise.reject(e)), listApps: vi.fn(async () => []) });
    const spent = holding("tok1");
    await expect(
      redeemPendingInvite(withRoutes(refusing(new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed"))), "abc", spent),
    ).rejects.toThrow();
    expect(spent.token()).toBeNull();
    // A lapsed session, a rate limit, the cluster or the network down: kept (B6).
    for (const e of [
      new CalimeroError(401, "UNAUTHORIZED", "session expired"),
      new CalimeroError(429, "RATE_LIMITED", "slow down"),
      new CalimeroError(503, "UNAVAILABLE", "later"),
      new TypeError("Failed to fetch"),
    ]) {
      const kept = holding("tok1");
      await expect(redeemPendingInvite(withRoutes(refusing(e)), "abc", kept)).rejects.toBe(e);
      expect(kept.token()).toBe("tok1");
    }
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
