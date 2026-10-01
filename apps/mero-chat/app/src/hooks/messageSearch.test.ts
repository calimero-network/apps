import { describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../api/clientApi";
import {
  applyPage,
  failPage,
  isMissingMethod,
  isSearchOff,
  mapConcurrent,
  resultPosition,
  nextToFetch,
  startSearch,
  threshold,
  visibleResults,
  withTimeout,
} from "./messageSearch";

const ctx = (id: string) => ({
  contextId: id,
  executorPublicKey: `key-${id}`,
  label: id,
});

function hit(id: string, anchor: number, extra: Partial<SearchHit> = {}): SearchHit {
  return {
    id,
    parent_message_id: null,
    index: anchor,
    timestamp: anchor,
    anchor_timestamp: anchor,
    sender: "s",
    snippet: id,
    match_start: 0,
    match_end: 1,
    ...extra,
  };
}

describe("messageSearch merge", () => {
  it("shows nothing until every context has answered once", () => {
    const [a, b] = startSearch([ctx("a"), ctx("b")]);
    const answered = applyPage(a, { hits: [hit("x", 5)], next_cursor: null, frontier_timestamp: 5 });
    expect(threshold([answered, b])).toBe(Infinity);
    expect(visibleResults([answered, b])).toEqual([]);
  });

  it("releases a hit once no unfinished context can outrank it", () => {
    const [a, b] = startSearch([ctx("a"), ctx("b")]);
    const doneA = applyPage(a, { hits: [hit("a1", 100)], next_cursor: null, frontier_timestamp: 100 });
    const moreB = applyPage(b, { hits: [hit("b1", 300)], next_cursor: "c", frontier_timestamp: 200 });
    expect(threshold([doneA, moreB])).toBe(200_000);
    expect(visibleResults([doneA, moreB]).map((r) => r.id)).toEqual(["b1"]);
    expect(nextToFetch([doneA, moreB])).toEqual([1]);

    const doneB = applyPage(moreB, { hits: [], next_cursor: null, frontier_timestamp: 50 });
    expect(threshold([doneA, doneB])).toBe(-Infinity);
    expect(visibleResults([doneA, doneB]).map((r) => r.id)).toEqual(["b1", "a1"]);
  });

  it("keeps the lowest frontier seen and drops a repeated hit", () => {
    const [a] = startSearch([ctx("a")]);
    const one = applyPage(a, { hits: [hit("x", 90)], next_cursor: "c", frontier_timestamp: 80 });
    const two = applyPage(one, { hits: [hit("x", 90)], next_cursor: "d", frontier_timestamp: 85 });
    expect(two.frontier).toBe(80_000);
    expect(two.hits).toHaveLength(1);
    expect(two.cursor).toBe("d");
  });

  it("lists a thread's parent before its replies, replies oldest first", () => {
    const [a] = startSearch([ctx("a")]);
    const s = applyPage(a, {
      hits: [
        hit("parent", 10),
        hit("r2", 10, { parent_message_id: "parent", timestamp: 30 }),
        hit("r1", 10, { parent_message_id: "parent", timestamp: 20 }),
        hit("newer", 40),
      ],
      next_cursor: null,
      frontier_timestamp: 10,
    });
    expect(visibleResults([s]).map((r) => r.id)).toEqual(["newer", "parent", "r1", "r2"]);
    expect(s.hits.find((h) => h.id === "r1")?.indexMessageId).toBe("parent");
  });

  it("reads the highest frontiers first, and never a finished context", () => {
    const states = startSearch([ctx("a"), ctx("b"), ctx("c")]).map((s, i) =>
      applyPage(s, { hits: [], next_cursor: i === 2 ? null : "c", frontier_timestamp: [10, 30, 99][i] }),
    );
    expect(nextToFetch(states)).toEqual([1, 0]);
    expect(nextToFetch([failPage(states[0], "x"), states[1]])).toEqual([1]);
  });
});

describe("messageSearch helpers", () => {
  it("withTimeout rejects a promise that never settles", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 10_000);
    const check = expect(pending).rejects.toThrow("No answer within 10s");
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
    vi.useRealTimers();
  });

  it("mapConcurrent keeps order and the limit", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it("recognises a missing search_messages", () => {
    expect(isMissingMethod('method "search_messages" not found')).toBe(true);
    expect(isMissingMethod("MethodNotFound")).toBe(true);
    expect(isMissingMethod("Search term too long")).toBe(false);
    expect(isMissingMethod(undefined)).toBe(false);
  });

  it("recognises a node running with search off", () => {
    expect(
      isSearchOff(
        "search_query is only available in a view (#[app::view]) on a node with search",
      ),
    ).toBe(true);
    expect(isSearchOff("full-text search needs a node")).toBe(true);
    expect(isSearchOff("Search term too long")).toBe(false);
    expect(isSearchOff(undefined)).toBe(false);
  });

  it("asks where an index hit sits only when the search did not say", async () => {
    const [state] = startSearch([ctx("a")]);
    const page = applyPage(state, {
      hits: [hit("m", 5, { index: null }), hit("r", 4, { index: 2, parent_message_id: "p" })],
      next_cursor: null,
      frontier_timestamp: 4,
    });
    const [fromIndex, fromScan] = page.hits;
    expect(fromIndex.index).toBe(-1);
    const lookup = vi.fn(async () => ({ data: 7, error: null }));
    expect(await resultPosition(fromIndex, lookup)).toBe(7);
    expect(lookup).toHaveBeenCalledWith({
      messageId: "m",
      contextId: "a",
      executorPublicKey: "key-a",
    });
    expect(await resultPosition(fromScan, lookup)).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await resultPosition(fromIndex, async () => ({ data: null, error: null }))).toBeNull();
    expect(
      await resultPosition(fromIndex, async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});
