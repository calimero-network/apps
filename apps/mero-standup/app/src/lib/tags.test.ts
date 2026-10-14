import { describe, expect, it } from "vitest";
import { parseTags } from "./tags";

describe("tags", () => {
  it("normalizes like the contract: trim, lower-case, dash inner spaces, dedupe, sort", () => {
    expect(parseTags("Infra, release  process, infra,, ")).toEqual(["infra", "release-process"]);
    expect(parseTags("")).toEqual([]);
  });
});
