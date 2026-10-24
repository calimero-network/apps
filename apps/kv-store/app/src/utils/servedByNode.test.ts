import { describe, expect, it } from "vitest";
import { isNodeAppHost } from "./servedByNode";

const LABEL = "a".repeat(52);

describe("isNodeAppHost", () => {
  it("accepts a node's app host", () => {
    expect(isNodeAppHost(`${LABEL}.localhost`)).toBe(true);
    expect(isNodeAppHost(`${LABEL}.apps.example`)).toBe(true);
  });

  it("rejects every other host", () => {
    for (const host of [
      "localhost",
      "mero-kv-store.vercel.app",
      `${"a".repeat(51)}.localhost`,
      `${"A".repeat(52)}.localhost`,
      `${"a".repeat(53)}.localhost`,
      LABEL,
    ]) {
      expect(isNodeAppHost(host)).toBe(false);
    }
  });
});
