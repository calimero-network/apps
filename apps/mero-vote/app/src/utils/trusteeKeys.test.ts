import { describe, expect, it } from "vitest";
import { loadTrusteeKey, parseTrusteeKey, saveTrusteeKey, type TrusteeKey } from "./trusteeKeys";

const key: TrusteeKey = { v: 1, contextId: "ctx", pollId: "poll", account: "acct", secret: "0a".repeat(32) };

describe("trustee keys", () => {
  it("round-trips through storage", () => {
    expect(saveTrusteeKey(key, window.localStorage)).toBe(true);
    expect(loadTrusteeKey("ctx", "poll", "acct", window.localStorage)).toEqual(key);
    expect(loadTrusteeKey("ctx", "other", "acct", window.localStorage)).toBeNull();
  });

  it("refuses a backup for another poll or account", () => {
    const raw = JSON.stringify(key);
    expect(() => parseTrusteeKey(raw, { contextId: "ctx", pollId: "x", account: "acct" })).toThrow(/different poll/);
    expect(() => parseTrusteeKey(raw, { contextId: "ctx", pollId: "poll", account: "x" })).toThrow(/different account/);
    expect(() => parseTrusteeKey('{"v":1,"secret":"zz"}', { contextId: "ctx", pollId: "poll", account: "acct" })).toThrow();
  });
});
