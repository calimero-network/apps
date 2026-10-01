/**
 * Unit tests for useMessages.searchAllContexts / loadMoreSearch
 *
 * Mocks ClientApiDataSource.searchMessages (and the legacy
 * searchAllMessages) and verifies:
 *   - one page per context, at most SEARCH_CONCURRENCY in flight
 *   - results tagged with their context, merged newest-first
 *   - a hit below an unfinished context's frontier waits for load more,
 *     which continues from that context's cursor
 *   - empty query / no contexts clear the search without a call
 *   - errors: every context failing is the error, one of several is a note
 *   - a context whose app predates search_messages falls back
 *   - a node running with search off reads the same pages by scan
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessages } from "./useMessages";
import type {
  MessageWithReactions,
  SearchHit,
  SearchMessagesProps,
  SearchPage,
} from "../api/clientApi";
import { SEARCH_CONCURRENCY, SEARCH_PAGE_SIZE } from "./messageSearch";

// ── Mock ClientApiDataSource ────────────────────────────────────────────────

const mockSearchMessages = vi.fn();
const mockSearchAllMessages = vi.fn();
const mockSearchMessagesScan = vi.fn();

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    searchMessages = mockSearchMessages;
    searchAllMessages = mockSearchAllMessages;
    searchMessagesScan = mockSearchMessagesScan;
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A hit as the contract returns it (seconds). Typed so a contract change breaks it. */
function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  const timestamp = overrides.timestamp ?? 100;
  return {
    id: overrides.id ?? `msg-${Math.random()}`,
    parent_message_id: null,
    index: 0,
    timestamp,
    anchor_timestamp: timestamp,
    sender: "alice",
    snippet: "hello there",
    match_start: 0,
    match_end: 5,
    ...overrides,
  };
}

function page(
  hits: SearchHit[],
  next_cursor: string | null = null,
  frontier?: number,
): { data: SearchPage; error: null } {
  const oldest = hits.length
    ? Math.min(...hits.map((h) => h.anchor_timestamp))
    : null;
  return {
    data: {
      hits,
      next_cursor,
      frontier_timestamp: frontier ?? oldest,
    },
    error: null,
  };
}

const CTX_A = { contextId: "ctx-aaa", executorPublicKey: "key-aaa", label: "general" };
const CTX_B = { contextId: "ctx-bbb", executorPublicKey: "key-bbb", label: "random" };

/** Answers per context, and per cursor within it. */
function answer(
  table: Record<string, Record<string, ReturnType<typeof page>>>,
) {
  mockSearchMessages.mockImplementation((props: SearchMessagesProps) =>
    Promise.resolve(
      table[props.contextId]?.[props.cursor ?? "first"] ?? page([]),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("useMessages — searchAllContexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks each context for its first page, with a per-context limit", async () => {
    answer({});
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "hello");
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(2);
    const calls = mockSearchMessages.mock.calls.map((c) => c[0] as SearchMessagesProps);
    expect(calls.map((c) => c.contextId).sort()).toEqual([CTX_A.contextId, CTX_B.contextId]);
    for (const c of calls) {
      expect(c.query).toBe("hello");
      expect(c.cursor).toBeNull();
      expect(c.limit).toBe(SEARCH_PAGE_SIZE);
    }
    expect(calls.find((c) => c.contextId === CTX_A.contextId)?.executorPublicKey).toBe("key-aaa");
  });

  it("tags each result with its context and merges newest first", async () => {
    answer({
      [CTX_A.contextId]: { first: page([hit({ id: "a-new", timestamp: 300 }), hit({ id: "a-old", timestamp: 100 })]) },
      [CTX_B.contextId]: { first: page([hit({ id: "b-mid", timestamp: 200 })]) },
    });
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "q");
    });

    const ids = result.current.searchResults.map((r) => r.id);
    expect(ids).toEqual(["a-new", "b-mid", "a-old"]);
    const mid = result.current.searchResults[1];
    expect(mid.contextId).toBe(CTX_B.contextId);
    expect(mid.contextLabel).toBe("random");
    expect(mid.timestamp).toBe(200_000); // milliseconds for display
    expect(result.current.searchHasMore).toBe(false);
  });

  it("holds back what an unfinished context could still outrank, and load more continues it", async () => {
    // B has read down to t=250 and has more; A is done. A's hit at 100 is
    // older than anything B might still hold above it, so it waits.
    answer({
      [CTX_A.contextId]: { first: page([hit({ id: "a", timestamp: 100 })]) },
      [CTX_B.contextId]: {
        first: page([hit({ id: "b1", timestamp: 300 })], "b-cursor", 250),
        "b-cursor": page([hit({ id: "b2", timestamp: 150 })], null, 150),
      },
    });
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "q");
    });

    // The first search keeps reading until a page can be shown or history
    // ends; here it reads B's second page on its own.
    expect(result.current.searchResults.map((r) => r.id)).toEqual(["b1", "b2", "a"]);
    const cursors = mockSearchMessages.mock.calls
      .map((c) => c[0] as SearchMessagesProps)
      .filter((c) => c.contextId === CTX_B.contextId)
      .map((c) => c.cursor);
    expect(cursors).toEqual([null, "b-cursor"]);
    expect(result.current.searchHasMore).toBe(false);
  });

  it("load more reads the next page from each context's own cursor", async () => {
    const many = (prefix: string, from: number) =>
      Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) =>
        hit({ id: `${prefix}${i}`, timestamp: from - i }),
      );
    answer({
      [CTX_A.contextId]: {
        first: page(many("a", 1000), "a2"),
        a2: page([hit({ id: "a-last", timestamp: 10 })]),
      },
    });
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "q");
    });
    expect(result.current.searchResults).toHaveLength(SEARCH_PAGE_SIZE);
    expect(result.current.searchHasMore).toBe(true);
    expect(mockSearchMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.loadMoreSearch();
    });
    expect(mockSearchMessages).toHaveBeenCalledTimes(2);
    expect((mockSearchMessages.mock.calls[1][0] as SearchMessagesProps).cursor).toBe("a2");
    const shown = result.current.searchResults;
    expect(shown[shown.length - 1]?.id).toBe("a-last");
    expect(result.current.searchHasMore).toBe(false);
  });

  it("never has more than SEARCH_CONCURRENCY pages in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    mockSearchMessages.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return page([]);
    });
    const contexts = Array.from({ length: 10 }, (_, i) => ({
      contextId: `ctx-${i}`,
      executorPublicKey: `key-${i}`,
      label: `c${i}`,
    }));
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts(contexts, "q");
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(10);
    expect(peak).toBe(SEARCH_CONCURRENCY);
  });

  it("sets searchQuery to the trimmed query", async () => {
    answer({});
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "  hello world  ");
    });

    expect(result.current.searchQuery).toBe("hello world");
    expect((mockSearchMessages.mock.calls[0][0] as SearchMessagesProps).query).toBe("hello world");
  });

  it("clears state when the query is empty, without a call", async () => {
    answer({ [CTX_A.contextId]: { first: page([hit({ id: "seed" })]) } });
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "seed");
    });
    await waitFor(() => expect(result.current.searchResults.length).toBe(1));

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "");
    });

    expect(result.current.searchResults).toHaveLength(0);
    expect(result.current.searchQuery).toBe("");
    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
  });

  it("clears state when the context list is empty", async () => {
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([], "hello");
    });

    expect(mockSearchMessages).not.toHaveBeenCalled();
    expect(result.current.searchResults).toHaveLength(0);
  });

  it("sets isSearching while a page is outstanding", async () => {
    let resolve!: (v: ReturnType<typeof page>) => void;
    mockSearchMessages.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useMessages());

    let done = false;
    act(() => {
      void result.current.searchAllContexts([CTX_A], "query").then(() => {
        done = true;
      });
    });
    await waitFor(() => expect(result.current.isSearching).toBe(true));

    await act(async () => {
      resolve(page([]));
    });
    await waitFor(() => expect(done).toBe(true));
    expect(result.current.isSearching).toBe(false);
  });

  it("reports the error when every context fails", async () => {
    mockSearchMessages.mockRejectedValue(new Error("Network timeout"));
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "query");
    });

    expect(result.current.searchError).toBe("Network timeout");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.searchResults).toHaveLength(0);
  });

  it("shows the others' results and names the failure when one context fails", async () => {
    mockSearchMessages.mockImplementation((props: SearchMessagesProps) =>
      props.contextId === CTX_A.contextId
        ? Promise.resolve({ data: null, error: { code: 500, message: "boom" } })
        : Promise.resolve(page([hit({ id: "b" })])),
    );
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "q");
    });

    expect(result.current.searchResults.map((r) => r.id)).toEqual(["b"]);
    expect(result.current.searchError).toBe("1 of 2 conversations could not be searched");
  });

  it("falls back to search_all_messages where the app predates search_messages", async () => {
    mockSearchMessages.mockResolvedValue({
      data: null,
      error: { code: -32000, message: 'method "search_messages" not found' },
    });
    const legacy: MessageWithReactions = {
      id: "old-1",
      text: "<p>the <b>merger</b> closes</p>",
      sender: "bob",
      timestamp: 50,
      index: 7,
      files: [],
      images: [],
      reactions: {},
      thread_count: 0,
      thread_last_timestamp: 0,
    };
    mockSearchAllMessages.mockResolvedValue({
      data: { messages: [legacy], total_count: 1, start_position: 0 },
      error: null,
    });
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "Merger");
    });

    expect(mockSearchAllMessages).toHaveBeenCalledTimes(1);
    const [r] = result.current.searchResults;
    expect(r.id).toBe("old-1");
    expect(r.snippet).toBe("the merger closes");
    expect(r.snippet.slice(r.matchStart, r.matchEnd)).toBe("merger");
    expect(r.index).toBe(7);
    expect(result.current.searchHasMore).toBe(false);
    expect(result.current.searchError).toBeNull();
  });

  it("reads the same pages by scan where the node runs with search off", async () => {
    mockSearchMessages.mockResolvedValue({
      data: null,
      error: {
        code: -32000,
        message:
          "search_query is only available in a view (#[app::view]) on a node with search",
      },
    });
    mockSearchMessagesScan
      .mockResolvedValueOnce(page([hit({ id: "new", timestamp: 90 })], "c1"))
      .mockResolvedValueOnce(page([hit({ id: "old", timestamp: 10 })]));
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "q");
    });
    // The search reads on until it has a page to show, from the scan's cursor.
    expect(mockSearchMessagesScan).toHaveBeenCalledTimes(2);
    expect(mockSearchMessagesScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "q", cursor: "c1", contextId: CTX_A.contextId }),
    );
    expect(result.current.searchResults.map((r) => r.id)).toEqual(["new", "old"]);
    expect(result.current.searchHasMore).toBe(false);
    expect(result.current.searchError).toBeNull();
    expect(mockSearchAllMessages).not.toHaveBeenCalled();
  });
});
