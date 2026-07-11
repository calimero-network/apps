import { beforeEach, describe, expect, it } from "vitest";
import {
  captureSessionFromHash,
  clearSession,
  getAccessToken,
  getSession,
  hasConnection,
  isAuthenticated,
  resetSession,
  updateSession,
} from "../src/net/session";

const FULL_HASH =
  "#node_url=http://localhost:2660&access_token=at-1&refresh_token=rt-1" +
  "&app-id=app-1&context_id=ctx-1&executor_public_key=pk-1&expires_at=999&dev_mode=1";

beforeEach(() => {
  localStorage.clear();
  resetSession();
  window.history.replaceState({}, "", "/");
  window.location.hash = "";
});

describe("desktop SSO capture", () => {
  it("captures the full desktop hash, strips it, and reports full", () => {
    window.location.hash = FULL_HASH;
    expect(captureSessionFromHash()).toBe("full");
    const s = getSession();
    expect(s.nodeUrl).toBe("http://localhost:2660");
    expect(s.contextId).toBe("ctx-1");
    expect(s.applicationId).toBe("app-1");
    expect(s.executorPublicKey).toBe("pk-1");
    expect(s.devMode).toBe(true);
    expect(getAccessToken()).toBe("at-1");
    expect(window.location.hash).toBe("");
    expect(hasConnection()).toBe(true);
  });

  it("tolerates the application_id spelling too", () => {
    window.location.hash =
      "#node_url=http://n&access_token=a&refresh_token=r&application_id=app-2&context_id=c";
    captureSessionFromHash();
    expect(getSession().applicationId).toBe("app-2");
  });

  it("ignores a hash without credentials", () => {
    window.location.hash = "#context_id=ctx-9";
    expect(captureSessionFromHash()).toBe("none");
    expect(hasConnection()).toBe(false);
  });

  it("stores tokens in the shared mero-tokens format", () => {
    window.location.hash = FULL_HASH;
    captureSessionFromHash();
    const tokens = JSON.parse(localStorage.getItem("mero-tokens")!);
    expect(tokens.access_token).toBe("at-1");
    expect(tokens.refresh_token).toBe("rt-1");
  });

  it("persists the session for hash-less refreshes", () => {
    window.location.hash = FULL_HASH;
    captureSessionFromHash();
    resetSession();
    window.location.hash = "";
    expect(captureSessionFromHash()).toBe("none"); // no hash, but restored…
    expect(getSession().contextId).toBe("ctx-1"); // …from storage
    expect(hasConnection()).toBe(true);
  });
});

describe("web auth callback capture", () => {
  it("uses the pending node url when the callback omits node_url", () => {
    localStorage.setItem("mb-pending-node", "http://mynode:2428");
    window.location.hash = "#access_token=at-2&refresh_token=rt-2&context_identity=id-2";
    expect(captureSessionFromHash()).toBe("partial"); // no context yet → picker
    const s = getSession();
    expect(s.nodeUrl).toBe("http://mynode:2428");
    expect(s.executorPublicKey).toBe("id-2"); // context_identity alias
    expect(localStorage.getItem("mb-pending-node")).toBeNull(); // consumed
    expect(isAuthenticated()).toBe(true);
    expect(hasConnection()).toBe(false);
  });

  it("reports full when the callback carries a context", () => {
    localStorage.setItem("mb-pending-node", "http://mynode:2428");
    window.location.hash = "#access_token=at&refresh_token=rt&context_id=ctx-w";
    expect(captureSessionFromHash()).toBe("full");
    expect(hasConnection()).toBe(true);
  });

  it("rejects a token hash when no node url is known at all", () => {
    window.location.hash = "#access_token=at-3&refresh_token=rt";
    expect(captureSessionFromHash()).toBe("none");
    expect(isAuthenticated()).toBe(false);
  });
});

describe("session lifecycle", () => {
  it("updateSession merges and persists", () => {
    window.location.hash = FULL_HASH;
    captureSessionFromHash();
    updateSession({ contextId: "ctx-other" });
    expect(getSession().contextId).toBe("ctx-other");
    expect(JSON.parse(localStorage.getItem("mb-session")!).contextId).toBe("ctx-other");
  });

  it("clearSession wipes state and tokens", () => {
    window.location.hash = FULL_HASH;
    captureSessionFromHash();
    clearSession();
    expect(hasConnection()).toBe(false);
    expect(isAuthenticated()).toBe(false);
    expect(localStorage.getItem("mb-session")).toBeNull();
    expect(localStorage.getItem("mero-tokens")).toBeNull();
  });
});
