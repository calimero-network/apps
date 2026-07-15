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

/** Build a JWT-shaped access token whose `exp` claim sits at `expMs`. */
function jwt(expMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

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

describe("single-use refresh — SSO hash never clobbers a rotated bundle (core#3083)", () => {
  it("keeps a rotated stored bundle when the desktop re-opens with an older hash (same node)", () => {
    const future = Date.now() + 3_600_000;
    // this browser already rotated its refresh token past the desktop's bundle
    localStorage.setItem(
      "mb-session",
      JSON.stringify({ nodeUrl: "http://localhost:2660", contextId: "ctx-1" }),
    );
    localStorage.setItem(
      "mero-tokens",
      JSON.stringify({ access_token: jwt(future), refresh_token: "rotated-rt", expires_at: future }),
    );

    // desktop re-opens with its original (older/opaque) bundle
    window.location.hash = FULL_HASH;
    captureSessionFromHash();

    const tokens = JSON.parse(localStorage.getItem("mero-tokens")!);
    expect(tokens.refresh_token).toBe("rotated-rt"); // NOT clobbered by rt-1
    expect(getAccessToken()).toBe(jwt(future));
  });

  it("adopts the hash bundle when the node changed (foreign token family)", () => {
    const future = Date.now() + 3_600_000;
    localStorage.setItem("mb-session", JSON.stringify({ nodeUrl: "http://oldnode:2428" }));
    localStorage.setItem(
      "mero-tokens",
      JSON.stringify({ access_token: jwt(future), refresh_token: "foreign-rt", expires_at: future }),
    );

    window.location.hash = FULL_HASH; // node_url=http://localhost:2660 → different node
    captureSessionFromHash();

    expect(JSON.parse(localStorage.getItem("mero-tokens")!).refresh_token).toBe("rt-1");
  });

  it("adopts the hash bundle when it is genuinely newer (a fresh login)", () => {
    const stale = Date.now() + 60_000;
    const fresh = Date.now() + 3_600_000;
    localStorage.setItem("mb-session", JSON.stringify({ nodeUrl: "http://localhost:2660" }));
    localStorage.setItem(
      "mero-tokens",
      JSON.stringify({ access_token: jwt(stale), refresh_token: "old-rt", expires_at: stale }),
    );

    window.location.hash =
      `#node_url=http://localhost:2660&access_token=${jwt(fresh)}&refresh_token=new-rt&context_id=ctx-1`;
    captureSessionFromHash();

    expect(JSON.parse(localStorage.getItem("mero-tokens")!).refresh_token).toBe("new-rt");
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
