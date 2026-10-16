import { describe, expect, it } from "vitest";
import {
  confirmText,
  deleteFeed,
  factsLine,
  feedLabel,
  nameProblem,
  orderFeeds,
  readFeedNames,
  renameFeed,
  suggestName,
  type FeedAdmin,
  type NamesAdmin,
} from "./feeds";

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
    // The context first: the namespace delete only unregisters it, so its
    // data would stay on the node.
    expect(calls).toEqual(["context f1", "namespace ns1"]);
  });

  it("still deletes the namespace when the context delete is refused (an app token)", async () => {
    const { a, calls } = admin({ f1: "ns1" }, { ns1: ["f1"] });
    a.deleteContext = async () => {
      throw Object.assign(new Error("HTTP 403 Forbidden"), { status: 403 });
    };
    expect(await deleteFeed(a, "f1")).toEqual({ namespace: true });
    expect(calls).toEqual(["namespace ns1"]);
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

describe("feed names", () => {
  it("takes a name of 1-64 characters", () => {
    expect(nameProblem("Work")).toBeNull();
    expect(nameProblem("   ")).toBe("Give the feed a name.");
    expect(nameProblem("x".repeat(64))).toBeNull();
    expect(nameProblem("x".repeat(65))).toBe("A name is at most 64 characters.");
  });

  it("suggests My feed, then the first free number", () => {
    expect(suggestName([])).toBe("My feed");
    expect(suggestName([null, "Work"])).toBe("My feed");
    expect(suggestName(["my feed", "My feed 2"])).toBe("My feed 3");
    expect(suggestName(["Work"], "Work")).toBe("Work 2");
  });

  it("labels an unnamed feed by its short id", () => {
    expect(feedLabel(null, "c8c2844e0000aaaa")).toBe("Unnamed feed · c8c2844e");
    expect(feedLabel("Work", "c8c2844e0000aaaa")).toBe("Work · c8c2844e");
  });

  function names() {
    const calls: string[] = [];
    const a: NamesAdmin = {
      getContextsForApplication: async () => ({ contexts: [{ id: "f1", groupId: "ns1" }, { id: "f2" }] }),
      listNamespacesForApplication: async () => [{ namespaceId: "ns1", name: "Work" }, { namespaceId: "ns2" }],
      getContextGroup: async (id) => (id === "f2" ? "ns2" : null),
      getGroupMetadata: async () => ({ name: null, data: { keep: "ns" } }),
      setGroupMetadata: async (g, r) => void calls.push(`namespace ${g} ${JSON.stringify(r)}`),
      getContextMetadata: async () => null,
      setContextMetadata: async (g, c, r) => void calls.push(`context ${g}/${c} ${JSON.stringify(r)}`),
    };
    return { a, calls };
  }

  it("reads each feed's name from its namespace", async () => {
    expect(await readFeedNames(names().a, "hf")).toEqual({
      f1: { name: "Work", namespace: "ns1" },
      f2: { name: null, namespace: "ns2" },
    });
  });

  it("renames the namespace and the context, keeping their data", async () => {
    const { a, calls } = names();
    await renameFeed(a, "f2", null, "  Home ");
    expect(calls).toEqual([
      'namespace ns2 {"name":"Home","data":{"keep":"ns"}}',
      'context ns2/f2 {"name":"Home","data":{}}',
    ]);
    await expect(renameFeed(a, "f2", "ns2", "")).rejects.toThrow("Give the feed a name.");
  });
});
