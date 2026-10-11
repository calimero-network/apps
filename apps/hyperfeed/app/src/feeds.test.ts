import { describe, expect, it } from "vitest";
import { confirmText, deleteFeed, factsLine, orderFeeds, type FeedAdmin } from "./feeds";

function admin(groups: Record<string, string>, inGroup: Record<string, string[]>) {
  const calls: string[] = [];
  const a: FeedAdmin = {
    getContextGroup: async (id) => groups[id] ?? null,
    deleteContext: async (id) => {
      calls.push(`context ${id}`);
      for (const g of Object.keys(inGroup)) inGroup[g] = inGroup[g]!.filter((c) => c !== id);
    },
    listGroupContexts: async (g) => (inGroup[g] ?? []).map((contextId) => ({ contextId })),
    deleteNamespace: async (g) => void calls.push(`namespace ${g}`),
  };
  return { a, calls };
}

describe("deleteFeed", () => {
  it("deletes the feed and the namespace it had to itself", async () => {
    const { a, calls } = admin({ f1: "ns1" }, { ns1: ["f1"] });
    expect(await deleteFeed(a, "f1")).toEqual({ namespace: true });
    expect(calls).toEqual(["context f1", "namespace ns1"]);
  });

  it("leaves a namespace that still holds another context", async () => {
    const { a, calls } = admin({ f1: "ns1" }, { ns1: ["f1", "other"] });
    expect(await deleteFeed(a, "f1")).toEqual({ namespace: false });
    expect(calls).toEqual(["context f1"]);
  });

  it("still deletes the feed when its namespace can't be found", async () => {
    const { a, calls } = admin({}, {});
    expect(await deleteFeed(a, "f1")).toEqual({ namespace: false });
    expect(calls).toEqual(["context f1"]);
  });
});

describe("what the switcher says", () => {
  const NOW = new Date(2026, 9, 10, 15, 0).getTime();

  it("names what a delete takes", () => {
    expect(confirmText({ rows: 39, at: 1 })).toBe("Delete this feed and its 39 rows? This can't be undone.");
    expect(confirmText({ rows: 1, at: 1 })).toBe("Delete this feed and its 1 row? This can't be undone.");
    expect(confirmText({ rows: 0, at: 0 })).toBe("Delete this empty feed? This can't be undone.");
    expect(confirmText(undefined)).toBe("Delete this feed and everything in it? This can't be undone.");
  });

  it("says how much a feed holds and when it last moved", () => {
    expect(factsLine({ rows: 39, at: NOW - 5 * 60_000 }, NOW)).toBe("39 rows · 5 min");
    expect(factsLine({ rows: 0, at: 0 }, NOW)).toBe("Empty");
    expect(factsLine({ rows: null, at: 0 }, NOW)).toBe("Could not read it");
    expect(factsLine(undefined, NOW)).toBe("");
  });

  it("lists the open feed first, then the empty ones, then the latest", () => {
    const facts = { a: { rows: 3, at: 100 }, b: { rows: 0, at: 0 }, c: { rows: 9, at: 300 }, cur: { rows: 1, at: 50 } };
    expect(orderFeeds(["a", "b", "c", "cur"], "cur", facts)).toEqual(["cur", "b", "c", "a"]);
  });
});
