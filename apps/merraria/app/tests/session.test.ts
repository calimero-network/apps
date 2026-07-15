import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSessionFromHash,
  clearSession,
  ensureFreshToken,
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
    localStorage.setItem("mt-pending-node", "http://mynode:2428");
    window.location.hash = "#access_token=at-2&refresh_token=rt-2&context_identity=id-2";
    expect(captureSessionFromHash()).toBe("partial"); // no context yet → picker
    const s = getSession();
    expect(s.nodeUrl).toBe("http://mynode:2428");
    expect(s.executorPublicKey).toBe("id-2"); // context_identity alias
    expect(localStorage.getItem("mt-pending-node")).toBeNull(); // consumed
    expect(isAuthenticated()).toBe(true);
    expect(hasConnection()).toBe(false);
  });

  it("reports full when the callback carries a context", () => {
    localStorage.setItem("mt-pending-node", "http://mynode:2428");
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
    expect(JSON.parse(localStorage.getItem("mt-session")!).contextId).toBe("ctx-other");
  });

  it("clearSession wipes state and tokens", () => {
    window.location.hash = FULL_HASH;
    captureSessionFromHash();
    clearSession();
    expect(hasConnection()).toBe(false);
    expect(isAuthenticated()).toBe(false);
    expect(localStorage.getItem("mt-session")).toBeNull();
    expect(localStorage.getItem("mero-tokens")).toBeNull();
  });
});

describe("ensureFreshToken (desktop hands over stale tokens — mero-chat lesson)", () => {
  const seedTokens = (expiresAt: number | string) => {
    window.location.hash =
      `#node_url=http://localhost:2660&access_token=old-at&refresh_token=old-rt` +
      `&context_id=ctx-1&expires_at=${expiresAt}`;
    captureSessionFromHash();
  };

  const errorResponse = (status: number, authError: string) => ({
    ok: false,
    status,
    headers: { get: (h: string) => (h === "x-auth-error" ? authError : null) },
    json: async () => ({ error: authError }),
  });

  /**
   * A node that models core#3083: refresh tokens are SINGLE-USE. Each POST
   * consumes the presented refresh token and mints a fresh pair; re-presenting
   * a consumed one is treated as theft — 401 `x-auth-error: token_reuse`, and
   * the whole family is revoked.
   *
   * The old static mock (same `new-rt` on every call) is precisely why the
   * double-spend bugs stayed green.
   */
  const rotatingNode = (opts: { expiresIn?: number } = {}) => {
    const consumed = new Set<string>();
    let live = "old-rt";
    let issued = 0;
    const presented: string[] = [];

    const fetchFn = vi.fn(async (_url: string, init: { body: string }) => {
      const rt = JSON.parse(init.body).refresh_token as string;
      presented.push(rt);
      if (consumed.has(rt)) return errorResponse(401, "token_reuse");
      if (rt !== live) return errorResponse(401, "token_invalid");
      consumed.add(rt);
      issued += 1;
      live = `rt-${issued}`;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: {
            access_token: `at-${issued}`,
            refresh_token: live,
            expires_at: Date.now() + (opts.expiresIn ?? 3600_000),
          },
        }),
      };
    }) as unknown as typeof fetch;

    return { fetchFn, presented, calls: () => presented.length };
  };

  it("refreshes an expired token via {node}/auth/refresh and stores the new pair", async () => {
    seedTokens(Date.now() - 1000);
    const node = rotatingNode();
    await ensureFreshToken(node.fetchFn);
    expect(node.fetchFn).toHaveBeenCalledWith(
      "http://localhost:2660/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(getAccessToken()).toBe("at-1");
    expect(JSON.parse(localStorage.getItem("mero-tokens")!).refresh_token).toBe("rt-1");
  });

  it("tolerates seconds-based expiry stamps", async () => {
    seedTokens(Math.floor(Date.now() / 1000) - 10); // expired, in seconds
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ access_token: "new-at", refresh_token: "new-rt" }), // un-nested shape
    })) as unknown as typeof fetch;
    await ensureFreshToken(fetchFn);
    expect(getAccessToken()).toBe("new-at");
  });

  it("does nothing when the token is still comfortably valid", async () => {
    seedTokens(Date.now() + 3600_000);
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await ensureFreshToken(fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe("old-at");
  });

  // The node REJECTS a refresh presented with a still-valid access token
  // ("Access token still valid" — core#3083), so the old 30s early-refresh skew
  // burned a request for nothing. Refresh only once actually expired.
  it("does not refresh early — a token expiring within 30s is left alone", async () => {
    seedTokens(Date.now() + 10_000); // inside the old 30s skew
    const node = rotatingNode();
    await ensureFreshToken(node.fetchFn);
    expect(node.calls()).toBe(0);
    expect(getAccessToken()).toBe("old-at");
  });

  it("single-flights concurrent callers — one refresh, never a replay", async () => {
    seedTokens(Date.now() - 1000);
    const node = rotatingNode();
    // Two callers racing (two game systems booting, or two tabs without Web
    // Locks). Unguarded, both POST `old-rt`: the second is a reuse → the node
    // revokes the family → everyone is logged out.
    await Promise.all([
      ensureFreshToken(node.fetchFn),
      ensureFreshToken(node.fetchFn),
      ensureFreshToken(node.fetchFn),
    ]);
    expect(node.calls()).toBe(1);
    expect(node.presented).toEqual(["old-rt"]);
    expect(getAccessToken()).toBe("at-1");
    expect(isAuthenticated()).toBe(true);
  });

  it("re-reads the store inside the guard — a later caller adopts the rotated bundle", async () => {
    seedTokens(Date.now() - 1000);
    const node = rotatingNode();
    await ensureFreshToken(node.fetchFn);
    // Sequential second call (the cross-tab loser, once the lock is released):
    // it must notice the bundle the winner stored is already fresh and NOT
    // re-present the refresh token it read on the way in.
    await ensureFreshToken(node.fetchFn);
    expect(node.calls()).toBe(1);
    expect(getAccessToken()).toBe("at-1");
  });

  it("treats a replayed (consumed) refresh token as terminal — 401 token_reuse", async () => {
    seedTokens(Date.now() - 1000);
    // The node already consumed `old-rt` (another holder rotated it) and has
    // revoked the family. Nothing we hold can ever work again.
    const fetchFn = vi.fn(async () => errorResponse(401, "token_reuse")) as unknown as typeof fetch;
    await ensureFreshToken(fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("mero-tokens")).toBeNull();
    expect(isAuthenticated()).toBe(false); // → boot falls through to the login screen
  });

  it("treats a revoked family as terminal — 403 token_revoked", async () => {
    seedTokens(Date.now() - 1000);
    const fetchFn = vi.fn(async () => errorResponse(403, "token_revoked")) as unknown as typeof fetch;
    await ensureFreshToken(fetchFn);
    expect(getAccessToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("keeps the old tokens when the refresh fails or the node is down", async () => {
    seedTokens(Date.now() - 1000);
    const failing = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    await ensureFreshToken(failing);
    expect(getAccessToken()).toBe("old-at");
    const throwing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await ensureFreshToken(throwing);
    expect(getAccessToken()).toBe("old-at");
  });

  // A transient server error must NOT nuke the session — only a reuse/revocation
  // is terminal. Otherwise a blip at boot logs the player out.
  it("keeps the session on a non-terminal error (500)", async () => {
    seedTokens(Date.now() - 1000);
    const fetchFn = vi.fn(async () => errorResponse(500, "")) as unknown as typeof fetch;
    await ensureFreshToken(fetchFn);
    expect(getAccessToken()).toBe("old-at");
    expect(isAuthenticated()).toBe(true);
  });

  it("no-ops without a session or without an expiry stamp", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await ensureFreshToken(fetchFn); // no session at all
    seedTokens(""); // desktop sent no expires_at — assume valid
    await ensureFreshToken(fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
