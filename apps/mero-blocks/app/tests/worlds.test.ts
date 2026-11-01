import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "@calimero-network/mero-js";
import type { KeyValueStorage, Target } from "@calimero-apps/connect";

import {
  captureInvite,
  createWorld,
  forgetWorld,
  inviteLink,
  lastWorld,
  listWorlds,
  pendingInvite,
  redeemPendingInvite,
  rememberWorld,
  worldSource,
} from "../src/net/worlds";

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
    expect((await listWorlds({ listApps }, "abc")).map((w) => w.name)).toEqual(["a", "b"]);
    expect(listApps).toHaveBeenLastCalledWith({ bundle: "abc" });
    await listWorlds({ listApps }, { package: "p" });
    expect(listApps).toHaveBeenLastCalledWith({ package: "p" });
  });

  it("are created in an organization of their own, with the init arguments", async () => {
    const createOrg = vi.fn(async () => "org-1");
    const createApp = vi.fn(async () => "app-1");
    const made = await createWorld({ createOrg, createApp }, "abc", "overworld", 1337, 1700000000);
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
  it("travel as ?invite= on this frontend and are captured before sign-in", () => {
    const link = inviteLink("tok 1", { origin: "http://localhost:5173", pathname: "/" });
    expect(link).toBe("http://localhost:5173/?invite=tok+1");
    window.history.replaceState(null, "", "/?invite=tok1&x=1");
    const storage = memory();
    captureInvite(storage);
    expect(pendingInvite(storage)).toBe("tok1");
    expect(window.location.search).toBe("?x=1");
  });

  it("are redeemed after sign-in, opening the world in the joined org", async () => {
    const storage = memory();
    storage.setItem("mero-blocks:pending-invite", "tok1");
    const client = {
      redeemInvite: vi.fn(async () => ({ org: "org-2" })),
      listApps: vi.fn(async () => [app("1", "a", "org-1"), app("2", "b", "org-2")]),
    };
    const world = await redeemPendingInvite(client, "abc", storage);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok1");
    expect(world?.appId).toBe("2");
    expect(pendingInvite(storage)).toBeNull();
  });

  it("drop a token the node refused, and do nothing without one", async () => {
    const storage = memory();
    const client = { redeemInvite: vi.fn(async () => { throw new Error("expired"); }), listApps: vi.fn(async () => []) };
    expect(await redeemPendingInvite(client, "abc", storage)).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    storage.setItem("mero-blocks:pending-invite", "tok1");
    await expect(redeemPendingInvite(client, "abc", storage)).rejects.toThrow("expired");
    expect(pendingInvite(storage)).toBeNull();
  });
});
