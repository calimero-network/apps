import { describe, it, expect, beforeEach } from "vitest";
import { writeSession } from "@calimero-apps/cloud";
import {
  clearContextId, getAccessToken, getContextId, getMeroClient, getNodeUrl, resetMeroClient,
  setContextId, setNodeUrl,
} from "./mero";

beforeEach(() => {
  localStorage.clear();
  writeSession(null);
});

const signIn = (token = "access-1") =>
  writeSession({ accountId: "acc", sessionToken: token, refreshToken: "refresh-1", expiresAt: Math.floor(Date.now() / 1000) + 3600 });

describe("node url", () => {
  it("round-trips through the SDK's storage", () => {
    expect(getNodeUrl()).toBeNull();
    setNodeUrl("http://localhost:2528");
    expect(getNodeUrl()).toBe("http://localhost:2528");
  });
});

describe("tokens", () => {
  it("are empty when signed out, rather than undefined", () => {
    expect(getAccessToken()).toBe("");
  });

  it("are the provider's session token once signed in", () => {
    signIn("access-1");
    expect(getAccessToken()).toBe("access-1");
    // Never in localStorage, where any script on the origin could read it.
    expect(JSON.stringify({ ...localStorage })).not.toContain("access-1");
  });
});

describe("clearContextId", () => {
  it("forgets the context but keeps the tokens — logout clears those separately", () => {
    setContextId("ctx-1");
    signIn("access-1");
    clearContextId();
    expect(getContextId() || null).toBeNull();
    expect(getAccessToken()).toBe("access-1");
  });
});

describe("getMeroClient", () => {
  beforeEach(() => resetMeroClient());

  it("is null until a node is selected — nothing to talk to", () => {
    expect(getMeroClient()).toBeNull();
  });

  it("is one client per node url, shared by rpc, admin and blobs", () => {
    setNodeUrl("http://localhost:2528");
    const a = getMeroClient();
    expect(a).not.toBeNull();
    expect(getMeroClient()).toBe(a);
    setNodeUrl("http://localhost:2529");
    expect(getMeroClient()).not.toBe(a);
  });

  it("picks up a login that happened after it was built", () => {
    // Keyed on the session token, so the next call after login gets a
    // client that carries it.
    setNodeUrl("http://localhost:2528");
    const anonymous = getMeroClient();
    expect(anonymous?.session).toBeUndefined();
    signIn("access-1");
    const signedIn = getMeroClient();
    expect(signedIn).not.toBe(anonymous);
    expect(signedIn?.session?.sessionToken).toBe("access-1");
  });
});
