import { describe, expect, it } from "vitest";
import { parseContextIds, parseSubgroupIds } from "./teamContexts";

// These two routes have shipped three envelope shapes between them. The walk
// that finds a team's documents is what a demotion depends on to revoke document
// access — if it silently returns [], a demoted admin keeps editing, and the
// toast still says the demotion succeeded.

describe("parseSubgroupIds", () => {
  it("reads a bare array", () => {
    expect(parseSubgroupIds([{ groupId: "g1" }, { groupId: "g2" }])).toEqual(["g1", "g2"]);
  });

  it("reads the { subgroups } envelope", () => {
    expect(parseSubgroupIds({ subgroups: [{ groupId: "g1" }] })).toEqual(["g1"]);
  });

  it("reads the { data } envelope", () => {
    expect(parseSubgroupIds({ data: [{ groupId: "g1" }] })).toEqual(["g1"]);
  });

  it("accepts snake_case and bare id spellings", () => {
    expect(parseSubgroupIds([{ group_id: "g1" }, { id: "g2" }])).toEqual(["g1", "g2"]);
  });

  it("drops entries with no usable id instead of yielding empty strings", () => {
    // An empty id would become `/groups//contexts` — a request that cannot
    // succeed but also would not look like a parse failure.
    expect(parseSubgroupIds([{ groupId: "" }, {}, { groupId: "g1" }])).toEqual(["g1"]);
  });

  it("returns [] for null, undefined and an unexpected shape", () => {
    expect(parseSubgroupIds(null)).toEqual([]);
    expect(parseSubgroupIds(undefined)).toEqual([]);
    expect(parseSubgroupIds({} as never)).toEqual([]);
  });
});

describe("parseContextIds", () => {
  it("reads a bare array", () => {
    expect(parseContextIds([{ contextId: "c1" }])).toEqual(["c1"]);
  });

  it("reads the { contexts }, { items } and { data } envelopes", () => {
    expect(parseContextIds({ contexts: [{ contextId: "c1" }] })).toEqual(["c1"]);
    expect(parseContextIds({ items: [{ contextId: "c2" }] })).toEqual(["c2"]);
    expect(parseContextIds({ data: [{ contextId: "c3" }] })).toEqual(["c3"]);
  });

  it("accepts snake_case and bare id spellings", () => {
    expect(parseContextIds([{ context_id: "c1" }, { id: "c2" }])).toEqual(["c1", "c2"]);
  });

  it("returns [] for null, undefined and an unexpected shape", () => {
    expect(parseContextIds(null)).toEqual([]);
    expect(parseContextIds(undefined)).toEqual([]);
    expect(parseContextIds({} as never)).toEqual([]);
  });
});
