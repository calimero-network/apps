import { beforeEach, describe, expect, it } from "vitest";
import {
  TOKENS_KEY,
  jwtExpiryMs,
  readStoredTokens,
  shouldSeedTokens,
  tokenExpiryMs,
} from "./authTokens";

/** Build a JWT-shaped token whose `exp` claim sits at `expMs`. */
function jwt(expMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

const store = (tokens: {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}) => localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));

beforeEach(() => localStorage.clear());

describe("jwtExpiryMs", () => {
  it("reads the `exp` claim as milliseconds", () => {
    const exp = Date.now() + 60_000;
    // second-resolution `exp` — compare on the same scale
    expect(jwtExpiryMs(jwt(exp))).toBe(Math.floor(exp / 1000) * 1000);
  });

  it("returns null for a non-JWT token", () => {
    expect(jwtExpiryMs("opaque-token")).toBeNull();
    expect(jwtExpiryMs("")).toBeNull();
  });
});

describe("readStoredTokens", () => {
  it("returns null when the bundle is absent, corrupt, or half-populated", () => {
    expect(readStoredTokens()).toBeNull();
    localStorage.setItem(TOKENS_KEY, "{not json");
    expect(readStoredTokens()).toBeNull();
    // mero-js's own store treats a missing refresh_token as unauthenticated
    store({ access_token: "at", refresh_token: "", expires_at: 1 });
    expect(readStoredTokens()).toBeNull();
  });

  it("reads a well-formed bundle", () => {
    store({ access_token: "at", refresh_token: "rt", expires_at: 42 });
    expect(readStoredTokens()).toEqual({
      access_token: "at",
      refresh_token: "rt",
      expires_at: 42,
    });
  });
});

describe("tokenExpiryMs", () => {
  it("prefers the JWT `exp` over the recorded expires_at", () => {
    const exp = Date.now() + 900_000;
    expect(
      tokenExpiryMs({ access_token: jwt(exp), refresh_token: "rt", expires_at: 1 }),
    ).toBe(Math.floor(exp / 1000) * 1000);
  });

  it("falls back to expires_at for opaque tokens", () => {
    expect(
      tokenExpiryMs({ access_token: "opaque", refresh_token: "rt", expires_at: 77 }),
    ).toBe(77);
  });
});

describe("shouldSeedTokens (single-use refresh — core#3083)", () => {
  const now = Date.now();

  it("seeds when nothing is stored", () => {
    expect(
      shouldSeedTokens({
        hashExpiresAtMs: now + 60_000,
        stored: null,
        nodeChanged: false,
      }),
    ).toBe(true);
  });

  it("does NOT clobber a bundle mero-js already rotated past the hash", () => {
    // The desktop re-opens this app with the bundle it minted at ITS login, while
    // mero-js has since rotated ours. The stored refresh token is the only live
    // one; the hash's was consumed by that rotation. Re-presenting it would be
    // read as theft (401 `token_reuse`) and revoke the whole family.
    expect(
      shouldSeedTokens({
        hashExpiresAtMs: now + 60_000, // desktop's original bundle
        stored: {
          access_token: jwt(now + 3_600_000), // rotated: expires later
          refresh_token: "rotated-rt",
          expires_at: now + 3_600_000,
        },
        nodeChanged: false,
      }),
    ).toBe(false);
  });

  it("does not re-seed the very same bundle it is already holding", () => {
    const at = jwt(now + 600_000);
    expect(
      shouldSeedTokens({
        hashExpiresAtMs: Math.floor((now + 600_000) / 1000) * 1000,
        stored: { access_token: at, refresh_token: "rt", expires_at: 0 },
        nodeChanged: false,
      }),
    ).toBe(false);
  });

  it("seeds when the hash carries a genuinely newer bundle (a fresh login)", () => {
    expect(
      shouldSeedTokens({
        hashExpiresAtMs: now + 3_600_000,
        stored: {
          access_token: jwt(now + 60_000),
          refresh_token: "old-rt",
          expires_at: now + 60_000,
        },
        nodeChanged: false,
      }),
    ).toBe(true);
  });

  it("seeds when the node changed — the stored bundle is a foreign token family", () => {
    expect(
      shouldSeedTokens({
        hashExpiresAtMs: now + 60_000,
        stored: {
          access_token: jwt(now + 3_600_000),
          refresh_token: "other-node-rt",
          expires_at: now + 3_600_000,
        },
        nodeChanged: true,
      }),
    ).toBe(true);
  });
});
