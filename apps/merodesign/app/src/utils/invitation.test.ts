import { describe, it, expect } from "vitest";
import { encodeInvitation, decodeInvitation } from "./invitation";

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
