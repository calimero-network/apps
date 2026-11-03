import { describe, expect, it } from "vitest";
import {
  confirmText,
  deleteFeed,
  factsLine,
  feedLabel,
  nameProblem,
  orderFeeds,
  createFeed,
  listFeeds,
  readFeedNames,
  renameFeed,
  suggestName,
} from "./feeds";
import type { AppInfo } from "@calimero-network/mero-js";

describe("feeds on the cluster", () => {
  it("lists the dev bundle's instances, or the package's, by name", async () => {
    const asked: unknown[] = [];
    const client = {
      listApps: async (filter: unknown) => {
        asked.push(filter);
        return [
          { appId: "b", name: "Work" },
          { appId: "a", name: "Home" },
        ] as AppInfo[];
      },
    };
    expect((await listFeeds(client, "bundle-1")).map((f) => f.appId)).toEqual(["a", "b"]);
    await listFeeds(client, { package: "com.calimero.hyperfeed" });
    expect(asked).toEqual([{ bundle: "bundle-1" }, { package: "com.calimero.hyperfeed" }]);
  });

  it("makes a feed in an organization of its own", async () => {
    const calls: string[] = [];
    const client = {
      createOrg: async (name: string) => (calls.push(`org ${name}`), "org-1"),
      createApp: async (name: string, source: unknown, options?: { org?: string }) => {
        calls.push(`app ${name} ${JSON.stringify(source)} ${options?.org}`);
        return "feed-1";
      },
    };
    expect(await createFeed(client, "bundle-1", "  Work ")).toBe("feed-1");
    expect(calls).toEqual(['org Work', 'app Work "bundle-1" org-1']);
    await expect(createFeed(client, "bundle-1", " ")).rejects.toThrow("Give the feed a name.");
  });

  it("deletes a feed's app instance", async () => {
    const gone: string[] = [];
    await deleteFeed({ deleteApp: async (id: string) => void gone.push(id) }, "feed-1");
    expect(gone).toEqual(["feed-1"]);
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

  function client(metadata: Record<string, Record<string, unknown> | null>) {
    const set: string[] = [];
    return {
      set,
      getApp: async (id: string) => ({ appId: id, metadata: metadata[id] ?? null }),
      setAppMetadata: async (id: string, m: unknown) => void set.push(`${id} ${JSON.stringify(m)}`),
    };
  }

  it("reads each feed's name: a rename in its metadata, else the one it was made with", async () => {
    const c = client({ f1: { name: "Work" } });
    expect(
      await readFeedNames(c, [
        { appId: "f1", name: "My feed" },
        { appId: "f2", name: "Home" },
        { appId: "f3", name: "" },
      ]),
    ).toEqual({ f1: "Work", f2: "Home", f3: null });
  });

  it("renames a feed in its metadata, keeping the rest", async () => {
    const c = client({ f2: { icon: "x" } });
    await renameFeed(c, "f2", "  Home ");
    expect(c.set).toEqual(['f2 {"icon":"x","name":"Home"}']);
    await expect(renameFeed(c, "f2", "")).rejects.toThrow("Give the feed a name.");
  });
});
