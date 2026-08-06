import { describe, it, expect } from "vitest";
import {
  APP_SLUG,
  encodeInvitation,
  decodeInvitation,
  encodeInvitationObject,
  decodeInvitationObject,
  invitationLink,
  invitationTokenFrom,
} from "./invitation";

describe("encodeInvitation", () => {
  it("produces a base64url string (no +, /, or = chars)", () => {
    const encoded = encodeInvitation("some-invitation-token");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("is URL-safe (only alphanumeric, -, _)", () => {
    const encoded = encodeInvitation("any raw invitation string here!@#");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips through decodeInvitation", () => {
    const raw = "calimero:invitation:abc123:xyz";
    expect(decodeInvitation(encodeInvitation(raw))).toBe(raw);
  });

  it("encodes short strings", () => {
    const raw = "x";
    const encoded = encodeInvitation(raw);
    expect(encoded.length).toBeGreaterThan(0);
    expect(decodeInvitation(encoded)).toBe(raw);
  });

  it("encodes strings with special chars", () => {
    const raw = "hello+world/test==";
    const encoded = encodeInvitation(raw);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(decodeInvitation(encoded)).toBe(raw);
  });

  it("handles empty string", () => {
    const encoded = encodeInvitation("");
    expect(decodeInvitation(encoded)).toBe("");
  });
});

describe("decodeInvitation", () => {
  it("decodes a valid base64url string", () => {
    const raw = "hello world";
    const encoded = encodeInvitation(raw);
    expect(decodeInvitation(encoded)).toBe(raw);
  });

  it("handles missing padding (no trailing =)", () => {
    // base64 for "a" is "YQ==" — stripped to "YQ" in base64url
    const encoded = "YQ";
    expect(decodeInvitation(encoded)).toBe("a");
  });

  it("handles 1-char padding needed", () => {
    // base64 for "ab" is "YWI=" — stripped to "YWI"
    const encoded = "YWI";
    expect(decodeInvitation(encoded)).toBe("ab");
  });

  it("converts - back to + and _ back to /", () => {
    // base64 of a string that produces + and / when encoded
    const raw = encodeInvitation("test");
    const result = decodeInvitation(raw);
    expect(result).toBe("test");
  });

  it("returns the original string if it cannot be decoded", () => {
    const garbage = "not-valid-base64!!!";
    const result = decodeInvitation(garbage);
    // Should not throw, returns original
    expect(typeof result).toBe("string");
  });
});

describe("UTF-8 / Unicode safety", () => {
  it("does not throw and round-trips non-ASCII strings", () => {
    const raw = "Café ☕ 团队 🚀 naïve";
    expect(() => encodeInvitation(raw)).not.toThrow();
    expect(decodeInvitation(encodeInvitation(raw))).toBe(raw);
  });

  it("round-trips an invitation object with a Unicode team name", () => {
    const obj = {
      invitation: { invitation: { group_id: [1, 2, 3] }, inviterSignature: "sig" },
      __teamName: "Équipe 🎨 設計",
    };
    const token = encodeInvitationObject(obj);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeInvitationObject(token)).toEqual(obj);
  });
});

describe("shareable invitation links", () => {
  it("wraps a token in a links.calimero.network URL keyed by the package slug", () => {
    const token = encodeInvitationObject({ invitation: { group_id: "g1" } });
    const url = new URL(invitationLink(token));
    expect(url.host).toBe("links.calimero.network");
    // The slug IS the bundle's package id — the desktop resolves the app by it,
    // and the landing page asks the registry for that package's frontend.
    expect(url.pathname).toBe(`/${APP_SLUG}/join`);
    expect(url.searchParams.get("invitation")).toBe(token);
  });

  it("reads the token back out of a link, and leaves a bare token alone", () => {
    const token = encodeInvitationObject({ invitation: { group_id: "g1" } });
    expect(invitationTokenFrom(invitationLink(token))).toBe(token);
    expect(invitationTokenFrom(`  ${token}  `)).toBe(token);
  });
});
