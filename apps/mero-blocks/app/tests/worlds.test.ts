import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "@calimero-network/mero-js";
import { createInviteStore, type InviteStore, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import { CalimeroError } from "@calimero-network/mero-js";
import {
  alreadyInInvitedWorld,
  createWorld,
  forgetWorld,
  invitedWorld,
  inviter,
  lastWorld,
  listWorlds,
  migrateStoredInvite,
  redeemPendingInvite,
  rememberWorld,
  worldInviteLink,
  worldSource,
} from "../src/net/worlds";
import { withRoutes } from "@calimero-apps/connect/testing";

function memory(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const app = (appId: string, name: string, org: string | null): AppInfo => ({
  appId,
  name,
  org,
  owner: "o",
  bundle: "b",
  package: null,
  version: null,
});

afterEach(() => window.history.replaceState(null, "", "/"));

describe("worlds are app instances", () => {
  it("come from the dev bundle, else the package", () => {
    expect(worldSource({ VITE_CALIMERO_BUNDLE: "abc" })).toBe("abc");
    expect(worldSource({})).toEqual({ package: "com.calimero.mero-blocks" });
  });

  it("are listed by bundle or package, by name", async () => {
    const listApps = vi.fn(async () => [app("2", "b", null), app("1", "a", null)]);
    expect((await listWorlds(withRoutes({ listApps }), "abc")).map((w) => w.name)).toEqual(["a", "b"]);
    expect(listApps).toHaveBeenLastCalledWith({ bundle: "abc" });
    await listWorlds(withRoutes({ listApps }), { package: "p" });
    expect(listApps).toHaveBeenLastCalledWith({ package: "p" });
  });

  it("are created in an organization of their own, with the init arguments", async () => {
    const createOrg = vi.fn(async () => "org-1");
    const createApp = vi.fn(async () => "app-1");
    const made = await createWorld(withRoutes({ createOrg, createApp }), "abc", "overworld", 1337, 1700000000);
    expect(made).toEqual({ appId: "app-1", org: "org-1", name: "overworld" });
    expect(createOrg).toHaveBeenCalledWith("overworld");
    expect(createApp).toHaveBeenCalledWith("overworld", "abc", {
      org: "org-1",
      initArgs: { name: "overworld", seed: "1337", now: "1700000000" },
    });
  });

  it("remember the one last played, per target and account", () => {
    const storage = memory();
    const target: Target = { kind: "local", nodes: ["http://127.0.0.1:2501"] };
    rememberWorld(target, "acc", "app-1", storage);
    expect(lastWorld(target, "acc", storage)).toBe("app-1");
    expect(lastWorld(target, "other", storage)).toBeNull();
    forgetWorld(target, "acc", storage);
    expect(lastWorld(target, "acc", storage)).toBeNull();
  });
});

describe("invitations are org invites", () => {
  function store(storage = memory()): InviteStore {
    return createInviteStore("mero-blocks", { storage, keep: ["world", "from"] });
  }
  function holding(token: string, org: string | null = null, extra: Record<string, string> = {}): InviteStore {
    const s = store();
    s.put({ token, org, team: null, doc: null, route: null, extra });
    return s;
  }

  it("travel as ?invite= with the org, the world and the inviter, and are captured before sign-in", () => {
    expect(worldInviteLink("tok 1", "org-2", { world: "app-2", from: "Alex", root: "/" })).toBe(
      `${window.location.origin}/?invite=tok+1&org=org-2&world=app-2&from=Alex`,
    );
    window.history.replaceState(null, "", "/?invite=tok1&org=org-2&world=app-2&from=Alex&x=1");
    const s = store();
    s.capture(window.location);
    expect(s.pending()).toMatchObject({ token: "tok1", org: "org-2" });
    expect(invitedWorld(s.pending())).toBe("app-2");
    expect(inviter(s.pending())).toBe("Alex");
    expect(window.location.search).toBe("?x=1");
  });

  it("are redeemed on Join, opening the world the link named, else the one in the joined org", async () => {
    const client = {
      redeemInvite: vi.fn(async () => ({ org: "org-2" })),
      listApps: vi.fn(async () => [app("1", "a", "org-1"), app("2", "b", "org-2"), app("3", "c", "org-2")]),
    };
    const s = holding("tok1");
    expect((await redeemPendingInvite(withRoutes(client), "abc", s))?.appId).toBe("2");
    expect(client.redeemInvite).toHaveBeenCalledWith("tok1");
    expect(s.token()).toBeNull();

    const named = holding("tok2", "org-2", { world: "3" });
    expect((await redeemPendingInvite(withRoutes(client), "abc", named))?.appId).toBe("3");
  });

  it("are not spent by a player already in the world they name", async () => {
    const listApps = vi.fn(async () => [app("1", "a", "org-1")]);
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

  it("do nothing without one", async () => {
    const client = { redeemInvite: vi.fn(), listApps: vi.fn(async () => []) };
    expect(await redeemPendingInvite(withRoutes(client), "abc", store())).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("stored by an older build move into the shared store", () => {
    const storage = memory();
    storage.setItem("mero-blocks:pending-invite", "tok-old");
    storage.setItem("mero-blocks:pending-invite-org", "org-2");
    const s = store(storage);
    migrateStoredInvite(s, storage);
    expect(s.pending()).toMatchObject({ token: "tok-old", org: "org-2" });
    expect(storage.getItem("mero-blocks:pending-invite")).toBeNull();
    expect(storage.getItem("mero-blocks:pending-invite-org")).toBeNull();

    // A link opened just now wins over the old one.
    const fresh = holding("tok-new");
    const old = memory();
    old.setItem("mero-blocks:pending-invite", "tok-old");
    migrateStoredInvite(fresh, old);
    expect(fresh.token()).toBe("tok-new");
  });
});
