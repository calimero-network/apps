import { describe, it, expect, beforeEach } from "vitest";
import {
  applyContextFromJwt, clearContextId, decodeJwt, getAccessToken, getContextId,
  getContextIdentity, getJwtPayload, getNodeUrl, setNodeUrl, setTokens,
} from "./mero";

/**
 * Build an unsigned JWT with the given payload — the signature is never read.
 *
 * UTF-8 encoded before base64, because `btoa` throws on anything outside Latin1
 * and a real issuer emits UTF-8. (That asymmetry is precisely what `decodeJwt`
 * has to undo, so the helper must not cheat by avoiding it.)
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let latin1 = "";
    for (const byte of bytes) latin1 += String.fromCharCode(byte);
    return btoa(latin1).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.signature`;
}

beforeEach(() => localStorage.clear());

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

  it("are stored where MeroProvider reads them", () => {
    setTokens("access-1", "refresh-1", 60);
    expect(getAccessToken()).toBe("access-1");
    // The provider's LocalStorageTokenStore key — writing anywhere else would
    // log the app in and leave the provider thinking it is signed out.
    const raw = JSON.parse(localStorage.getItem("mero-tokens")!);
    expect(raw).toMatchObject({ access_token: "access-1", refresh_token: "refresh-1" });
    expect(raw.expires_at).toBeGreaterThan(Date.now());
  });

  it("defaults the expiry when the callback omits expires_in", () => {
    setTokens("a", "r");
    const raw = JSON.parse(localStorage.getItem("mero-tokens")!);
    expect(raw.expires_at).toBeGreaterThan(Date.now());
  });

  it("ignores a nonsensical expires_in instead of expiring instantly", () => {
    setTokens("a", "r", -100);
    const raw = JSON.parse(localStorage.getItem("mero-tokens")!);
    expect(raw.expires_at).toBeGreaterThan(Date.now());
  });
});

describe("decodeJwt", () => {
  it("reads the payload", () => {
    expect(decodeJwt(jwt({ sub: "alice", context_id: "ctx-1" })))
      .toMatchObject({ sub: "alice", context_id: "ctx-1" });
  });

  it("handles base64url payloads — atob alone rejects these", () => {
    // `?` and `~` push the encoding into - and _ territory and need padding.
    const payload = { sub: "a?b~c", note: "Zürich 🎨" };
    expect(decodeJwt(jwt(payload))).toMatchObject(payload);
  });

  it("returns null for anything that is not a JWT", () => {
    for (const bad of [null, undefined, "", "not-a-jwt", "only.two", "a.!!!.c"]) {
      expect(decodeJwt(bad as string | null), String(bad)).toBeNull();
    }
  });

  it("returns null when the payload is not an object", () => {
    const b64 = btoa(JSON.stringify("just a string")).replace(/=+$/, "");
    expect(decodeJwt(`header.${b64}.sig`)).toBeNull();
  });

  it("reads the payload of the stored access token", () => {
    expect(getJwtPayload()).toBeNull();
    setTokens(jwt({ sub: "bob" }), "r");
    expect(getJwtPayload()).toMatchObject({ sub: "bob" });
  });
});

describe("applyContextFromJwt", () => {
  it("prefers the permissions[].context shape a scoped client key carries", () => {
    const ok = applyContextFromJwt(jwt({
      permissions: [{ context: { id: "ctx-scoped", key: "identity-scoped" } }],
    }));
    expect(ok).toBe(true);
    expect(getContextId()).toBe("ctx-scoped");
    expect(getContextIdentity()).toBe("identity-scoped");
  });

  it("skips string permissions (admin scopes) while looking for a context", () => {
    const ok = applyContextFromJwt(jwt({
      permissions: ["admin", { context: { id: "ctx-2", key: "k2" } }],
    }));
    expect(ok).toBe(true);
    expect(getContextId()).toBe("ctx-2");
  });

  it("falls back to flat claims, which older nodes issue", () => {
    const ok = applyContextFromJwt(jwt({ context_id: "ctx-flat", context_identity: "id-flat" }));
    expect(ok).toBe(true);
    expect(getContextId()).toBe("ctx-flat");
    expect(getContextIdentity()).toBe("id-flat");
  });

  it("accepts executor_public_key as the identity, as the oldest tokens name it", () => {
    applyContextFromJwt(jwt({ context_id: "ctx-3", executor_public_key: "exec-3" }));
    expect(getContextIdentity()).toBe("exec-3");
  });

  it("stores the context even when the token names no identity", () => {
    expect(applyContextFromJwt(jwt({ context_id: "ctx-4" }))).toBe(true);
    expect(getContextId()).toBe("ctx-4");
  });

  it("does nothing for a token with no context — MultiContext is the normal case", () => {
    // The rc.20 auth callback returns only tokens, application id and node url;
    // the app picks the context itself, and this must not invent one.
    expect(applyContextFromJwt(jwt({ sub: "alice", permissions: ["admin"] }))).toBe(false);
    expect(getContextId()).toBeNull();
  });

  it("does nothing for a malformed token", () => {
    expect(applyContextFromJwt("garbage")).toBe(false);
    expect(getContextId()).toBeNull();
  });
});

describe("clearContextId", () => {
  it("forgets the context but keeps the tokens — logout clears those separately", () => {
    applyContextFromJwt(jwt({ context_id: "ctx-1" }));
    setTokens("access-1", "refresh-1");
    clearContextId();
    expect(getContextId() || null).toBeNull();
    expect(getAccessToken()).toBe("access-1");
  });
});
