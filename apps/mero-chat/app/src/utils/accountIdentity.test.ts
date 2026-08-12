import { describe, expect, it } from "vitest";
import { hexToBase58 } from "./accountIdentity";

describe("hexToBase58", () => {
  it("matches the encoding the contract emits on `sender`", () => {
    // Captured from a live node: GET /admin-api/namespaces/{ns}/account
    // returned this accountId (hex), and the WASM stamped the base58 form on
    // the message. The self-check failed because the app only ever held
    // device ids, which live in a different identifier space entirely.
    const accountHex =
      "007c24434c4c26b01c4f5425ec06b0db51d3f4bde4ed8c30d409552567c48cda";
    const senderBase58 = "12tnudNJsrM2URKkrUawd5PMyMHZkyZ8LAwoZWSYxYmX";

    expect(hexToBase58(accountHex)).toBe(senderBase58);
  });

  it("preserves leading zero bytes (they become leading '1's)", () => {
    // The captured account starts with 0x00 — dropping it would shift the
    // whole encoding and silently never match.
    expect(hexToBase58("007c24434c4c26b01c4f5425ec06b0db51d3f4bde4ed8c30d409552567c48cda")).toMatch(/^1/);
  });

  it("accepts a 0x prefix", () => {
    expect(hexToBase58("0x00")).toBe(hexToBase58("00"));
  });

  it("returns empty for malformed input", () => {
    expect(hexToBase58("")).toBe("");
    expect(hexToBase58("abc")).toBe("");
  });
});
