import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeSession } from "@calimero-apps/cloud";
import {
  captureSessionFromHash,
  clearSession,
  clearWorld,
  getAccessToken,
  getSession,
  hasConnection,
  isAuthenticated,
  resetSession,
  updateSession,
} from "../src/net/session";

const now = () => Math.floor(Date.now() / 1000);

/** A player signed in to the cluster and inside a world. */
function signedInWithWorld() {
  writeSession({ accountId: "acc", sessionToken: "at-1", refreshToken: "rt-1", expiresAt: now() + 3600 });
  updateSession({ kind: "node", nodeUrl: "http://localhost:2660", contextId: "ctx-1", executorPublicKey: "acc" });
}

beforeEach(() => {
  localStorage.clear();
  resetSession();
  writeSession(null);
});
afterEach(() => writeSession(null));

describe("restoring the session", () => {
  it("is none when nobody is signed in", () => {
    expect(captureSessionFromHash()).toBe("none");
    expect(isAuthenticated()).toBe(false);
  });

  it("is full when signed in with a world, partial without one", () => {
    signedInWithWorld();
    resetSession();
    expect(captureSessionFromHash()).toBe("full");
    clearWorld();
    expect(captureSessionFromHash()).toBe("partial");
  });

  it("ignores a v1 token hash: there are no node tokens on Calimero Cloud", () => {
    window.location.hash = "#node_url=http://n&access_token=at&refresh_token=rt&context_id=c";
    expect(captureSessionFromHash()).toBe("none");
    expect(localStorage.getItem("mero-tokens")).toBeNull();
    window.location.hash = "";
  });

  it("keeps the session token out of localStorage", () => {
    signedInWithWorld();
    expect(getAccessToken()).toBe("at-1");
    expect(JSON.stringify({ ...localStorage })).not.toContain("at-1");
  });
});

describe("session lifecycle", () => {
  it("updateSession merges and persists", () => {
    updateSession({ nodeUrl: "http://a", contextId: "c" });
    resetSession();
    captureSessionFromHash();
    expect(getSession()).toMatchObject({ nodeUrl: "http://a", contextId: "c" });
  });

  it("clearSession signs out and forgets the world", () => {
    signedInWithWorld();
    clearSession();
    expect(isAuthenticated()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getSession().contextId).toBeNull();
  });
});

describe("clearWorld (stale-world recovery)", () => {
  it("drops the world coordinates but keeps the login", () => {
    signedInWithWorld();
    updateSession({ namespaceId: "ns-1", groupId: "grp-1", worldName: "Overworld" });
    expect(hasConnection()).toBe(true);

    clearWorld();

    const s = getSession();
    // Gone: everything that names a world this account may not be a member of.
    expect(s.contextId).toBeNull();
    expect(s.executorPublicKey).toBeNull();
    expect(s.namespaceId).toBeNull();
    expect(s.groupId).toBeNull();
    expect(s.worldName).toBeNull();
    // Kept: the login. The player picks another world, they do not log in again.
    expect(s.nodeUrl).toBe("http://localhost:2660");
    expect(getAccessToken()).toBe("at-1");
    expect(isAuthenticated()).toBe(true);
    // ...and `hasConnection()` is false, which is what routes boot() to the picker.
    expect(hasConnection()).toBe(false);
  });

  it("survives a reload — the cleared world is not still in storage", () => {
    signedInWithWorld();
    clearWorld();
    resetSession();
    captureSessionFromHash(); // restores from localStorage
    expect(getSession().contextId).toBeNull();
  });
});
