// The one switch: a signed-in player gets the cloud client for their cluster —
// v1's admin names over organizations, teams and app instances, and the rpc
// transport generated clients take.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  ensurePackage: vi.fn(async () => "package:com.calimero.merraria"),
  accountId: vi.fn(async () => "acct-1"),
}));
vi.mock("@calimero-apps/cloud", async (importOriginal) => {
  const real = await importOriginal<typeof import("@calimero-apps/cloud")>();
  class FakeMero extends (real.CloudMero as unknown as new (url: string) => object) {
    accountId = fakes.accountId;
  }
  return { ...real, CloudMero: FakeMero, ensurePackage: fakes.ensurePackage };
});

import { writeSession } from "@calimero-apps/cloud";
import { getSession, resetSession, sessionKind, updateSession } from "../src/net/session";
import { getTransport, resetTransport } from "../src/net/transport";

beforeEach(() => {
  localStorage.clear();
  resetSession();
  resetTransport();
  writeSession(null);
  vi.clearAllMocks();
});
afterEach(() => writeSession(null));

describe("session kind", () => {
  it("is null with nothing stored, node once a cluster is chosen", () => {
    expect(sessionKind()).toBeNull();
    updateSession({ kind: "node", nodeUrl: "https://cloud.example" });
    expect(sessionKind()).toBe("node");
  });

  it("refuses to build a transport with no session", async () => {
    await expect(getTransport()).rejects.toThrow(/sign in/);
  });
});

describe("the cloud transport", () => {
  beforeEach(() => updateSession({ kind: "node", nodeUrl: "https://cloud.example" }));

  it("is built once per cluster and rebuilt when it changes", async () => {
    const a = await getTransport();
    expect(await getTransport()).toBe(a);
    updateSession({ nodeUrl: "https://other.example" });
    expect(await getTransport()).not.toBe(a);
  });

  it("myId is the player's account, the contract's caller on Calimero Cloud", async () => {
    expect(await (await getTransport()).myId("ctx")).toBe("acct-1");
  });

  it("resolves the application as the signed package, installed through the cluster", async () => {
    const id = await (await getTransport()).resolveApplicationId();
    expect(id).toBe("package:com.calimero.merraria");
    expect(fakes.ensurePackage).toHaveBeenCalledWith(expect.anything(), "com.calimero.merraria", undefined, "https://apps.calimero.network");
    expect(getSession().applicationId).toBe(id);
  });

  it("admin names what the cluster lacks instead of pretending", async () => {
    const { admin } = await getTransport();
    await expect((admin as unknown as { grantAuthorship: () => Promise<void> }).grantAuthorship()).rejects.toThrow(/not available on Calimero Cloud/);
  });
});
