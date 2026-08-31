import { describe, expect, it } from "vitest";
import { decodeContractError } from "./rpc";

// The exact payload the node returned for a `grant_editor` on a member the
// document had never seen — a JSON-encoded UTF-8 byte array, quotes included.
const REAL_PAYLOAD =
  "the method call returned an error: [34, 116, 104, 97, 116, 32, 109, 101, 109, 98, 101, 114, 32, 104, 97, 115, 110, 39, 116, 32, 111, 112, 101, 110, 101, 100, 32, 116, 104, 105, 115, 32, 100, 111, 99, 117, 109, 101, 110, 116, 32, 121, 101, 116, 44, 32, 115, 111, 32, 116, 104, 101, 105, 114, 32, 97, 99, 99, 111, 117, 110, 116, 32, 105, 115, 32, 117, 110, 107, 110, 111, 119, 110, 32, 226, 128, 148, 32, 97, 115, 107, 32, 116, 104, 101, 109, 32, 116, 111, 32, 111, 112, 101, 110, 32, 105, 116, 32, 111, 110, 99, 101, 44, 32, 116, 104, 101, 110, 32, 115, 101, 116, 32, 116, 104, 101, 32, 114, 111, 108, 101, 34]";

describe("decodeContractError", () => {
  it("decodes a real contract abort into its message", () => {
    expect(decodeContractError(REAL_PAYLOAD)).toBe(
      "that member hasn't opened this document yet, so their account is unknown — ask them to open it once, then set the role",
    );
  });

  it("decodes multi-byte UTF-8 (the em dash) correctly", () => {
    // 226,128,148 is U+2014; a naive String.fromCharCode would mangle it.
    expect(decodeContractError(REAL_PAYLOAD)).toContain("—");
  });

  it("strips the surrounding JSON quotes", () => {
    expect(decodeContractError(REAL_PAYLOAD).startsWith('"')).toBe(false);
  });

  it("passes through a message with no byte array", () => {
    expect(decodeContractError("plain failure")).toBe("plain failure");
  });

  it("passes through when the bracketed list is not byte-valued", () => {
    expect(decodeContractError("oops [1, 999, 3]")).toBe("oops [1, 999, 3]");
  });

  it("decodes an unquoted (non-JSON) byte payload too", () => {
    // "hi" without surrounding quotes.
    expect(decodeContractError("err: [104, 105]")).toBe("hi");
  });
});
