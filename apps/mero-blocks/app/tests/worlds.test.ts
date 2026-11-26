import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "@calimero-network/mero-js";
import { createInviteStore, type InviteStore, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import {
  createWorld,
  forgetWorld,
  invitedWorld,
  lastWorld,
  listWorlds,
  migrateStoredInvite,
  rememberWorld,
  worldLinkBase,
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

const app = (appId: string, name: string, org: string): AppInfo => ({
  appId,
  name,
  org,
  owner: "o",
  bundle: "b",
  package: null,
  version: null,
  deployment: null,
});

afterEach(() => window.history.replaceState(null, "", "/"));

import { toSeed } from "../src/net/blocks";

describe("toSeed", () => {
  it("keeps a seed the contract takes (a u32), else the fallback", () => {
    expect(toSeed("42", 1337)).toBe(42);
    expect(toSeed("-42", 1337)).toBe(42);
    expect(toSeed("abc", 1337)).toBe(1337);
    expect(toSeed("0", 1337)).toBe(1337);
    expect(toSeed(2 ** 32 + 5, 1)).toBe(5);
  });
});

describe("worlds are app instances", () => {
  it("come from the dev bundle, else the package", () => {
    expect(worldSource({ VITE_CALIMERO_BUNDLE: "abc" })).toBe("abc");
    expect(worldSource({})).toEqual({ package: "com.calimero.mero-blocks" });
  });

  it("are listed by bundle or package, by name", async () => {
    const listApps = vi.fn(async () => [app("2", "b", ""), app("1", "a", "")]);
    expect((await listWorlds(withRoutes({ listApps }), "abc")).map((w) => w.name)).toEqual(["a", "b"]);
    expect(listApps).toHaveBeenLastCalledWith({ bundle: "abc" });
    await listWorlds(withRoutes({ listApps }), { package: "p" });
    expect(listApps).toHaveBeenLastCalledWith({ package: "p" });
  });

  it("are created in the organization the node made for them, with the init arguments", async () => {
    const createApp = vi.fn(async () => "app-1");
    const made = await createWorld(withRoutes({ createApp }), "abc", "overworld", 1337, "org-1", 1700000000);
    expect(made).toEqual({ appId: "app-1", org: "org-1", name: "overworld" });
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
    return createInviteStore("mero-blocks", { storage, keep: ["world"] });
  }
  function holding(token: string, org: string | null = null, extra: Record<string, string> = {}): InviteStore {
    const s = store();
    s.put({ token, org, team: null, doc: null, route: null, extra });
    return s;
  }

  it("link to a page naming the org and the world, and are captured before sign-in", () => {
    const base = new URL(worldLinkBase("org-2", "app-2"));
    expect(base.origin + base.pathname).toBe(`${window.location.origin}/`);
    expect(base.searchParams.get("org")).toBe("org-2");
    expect(base.searchParams.get("world")).toBe("app-2");
    expect(base.searchParams.has("from")).toBe(false);
    expect(new URL(worldLinkBase("org-2", "app-2", "Ada")).searchParams.get("from")).toBe("Ada");
    // The shared dialog puts the token in the fragment.
    window.history.replaceState(null, "", "/?org=org-2&world=app-2&x=1#invite=tok1");
    const s = store();
    s.capture(window.location);
    expect(s.pending()).toMatchObject({ token: "tok1", org: "org-2" });
    expect(invitedWorld(s.pending())).toBe("app-2");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("");
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
