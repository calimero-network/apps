// The one switch: a signed-in player's transport is the cloud client for their
// cluster. Admin, contract calls and identity all go through it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeSession } from "@calimero-apps/cloud";
import { installFakeCluster, type FakeCluster } from "@calimero-apps/cloud/testing";
import { resetSession, updateSession } from "../src/net/session";
import { getTransport, resetTransport } from "../src/net/transport";

let cluster: FakeCluster;

beforeEach(() => {
  localStorage.clear();
  resetSession();
  resetTransport();
  cluster = installFakeCluster();
  cluster.signIn("alice");
  writeSession({ accountId: "alice", sessionToken: "t", refreshToken: "r", expiresAt: 9e9 });
  updateSession({ kind: "node", nodeUrl: "https://cloud.example" });
});
afterEach(() => {
  cluster.uninstall();
  writeSession(null);
});

describe("the switch", () => {
  it("is one transport per session, rebuilt after a sign-out", () => {
    const a = getTransport();
    expect(getTransport()).toBe(a);
    resetTransport();
    expect(getTransport()).not.toBe(a);
  });
});

describe("the cloud transport", () => {
  it("calls the contract in the world's app instance, as the player", async () => {
    cluster.onCall(({ contextId, method, args, caller }) => ({ contextId, method, args, caller }));
    expect(await getTransport().exec("ctx-1", "place", { x: 1 })).toEqual({ contextId: "ctx-1", method: "place", args: { x: 1 }, caller: "alice" });
  });

  it("myId is the player's account, the contract's caller on Calimero Cloud", async () => {
    expect(await getTransport().resolveMyId("ctx-1")).toBe("alice");
  });

  it("creates a world as an organization, an open team and an app in it", async () => {
    const t = getTransport();
    const { namespaceId } = await t.admin.createNamespace("package:com.calimero.mero-blocks", "w");
    const groupId = await t.admin.createOpenGroup(namespaceId, "w");
    const { contextId } = await t.admin.createContext("package:com.calimero.mero-blocks", groupId, "w", []);
    expect(await t.admin.groupVisibility(groupId)).toBe("open");
    expect(await t.admin.contextGroup(contextId)).toBe(groupId);
    expect(await t.admin.identitiesOwned(contextId)).toEqual(["alice"]);
    expect((await t.admin.groupContexts(groupId)).map((c) => c.contextId)).toEqual([contextId]);
  });
});
