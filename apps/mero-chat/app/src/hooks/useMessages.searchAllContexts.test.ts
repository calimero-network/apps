/**
 * Unit tests for useMessages.searchAllContexts
 *
 * Mocks ClientApiDataSource.searchAllMessages and verifies:
 *   - parallel fan-out across multiple contexts
 *   - each result is tagged with contextLabel + contextId
 *   - merged results are sorted newest-first
 *   - empty query clears search state
 *   - API errors are captured in searchError
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessages } from "./useMessages";
import type { MessageWithReactions } from "../api/clientApi";

// ── Mock ClientApiDataSource ────────────────────────────────────────────────

const mockSearchAllMessages = vi.fn();

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    searchAllMessages = mockSearchAllMessages;
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A message as the node returns it.
 *
 * Typed as `MessageWithReactions` on purpose: an untyped literal is free to
 * keep describing fields the contract has dropped, which is exactly what
 * happened here — it carried a `sender_username` long after messages stopped
 * having one, and nothing complained. Annotating it means the next contract
 * change breaks this fixture at compile time instead of quietly leaving the
 * tests asserting against a shape the node never sends.
 */
function makeRawMessage(
  overrides: Partial<MessageWithReactions> = {},
): MessageWithReactions {
  return {
    id: overrides.id ?? `msg-${Math.random()}`,
    text: overrides.text ?? "hello",
    // An ACCOUNT id — names are resolved from it, never carried alongside it.
    sender: overrides.sender ?? "alice.near",
    timestamp: overrides.timestamp ?? Math.floor(Date.now() / 1000),
    index: overrides.index ?? 0,
    files: [],
    images: [],
    reactions: {},
    thread_count: 0,
    thread_last_timestamp: 0,
    ...overrides,
  };
}

function makeApiResponse(messages: ReturnType<typeof makeRawMessage>[]) {
  return {
    data: { messages, total_count: messages.length, start_position: 0 },
    error: null,
  };
}

const CTX_A = { contextId: "ctx-aaa", executorPublicKey: "key-aaa", label: "general" };
const CTX_B = { contextId: "ctx-bbb", executorPublicKey: "key-bbb", label: "random" };

// ─────────────────────────────────────────────────────────────────────────────

describe("useMessages — searchAllContexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fans out one API call per context", async () => {
    mockSearchAllMessages.mockResolvedValue(makeApiResponse([]));

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "hello");
    });

    expect(mockSearchAllMessages).toHaveBeenCalledTimes(2);
    const calls = mockSearchAllMessages.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const ctxIds = calls.map((c) => c.contextId);
    expect(ctxIds).toContain(CTX_A.contextId);
    expect(ctxIds).toContain(CTX_B.contextId);
  });

  it("tags each result with contextLabel and contextId", async () => {
    const msgA = makeRawMessage({ id: "a1", text: "from-general", timestamp: 1000 });
    const msgB = makeRawMessage({ id: "b1", text: "from-random", timestamp: 2000 });

    mockSearchAllMessages.mockImplementation(
      ({ contextId }: { contextId: string }) => {
        if (contextId === CTX_A.contextId) return Promise.resolve(makeApiResponse([msgA]));
        if (contextId === CTX_B.contextId) return Promise.resolve(makeApiResponse([msgB]));
        return Promise.resolve(makeApiResponse([]));
      },
    );

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "from");
    });

    await waitFor(() => expect(result.current.searchResults.length).toBe(2));

    const general = result.current.searchResults.find((m) => m.id === "a1");
    const random = result.current.searchResults.find((m) => m.id === "b1");

    expect(general?.contextLabel).toBe("general");
    expect(general?.contextId).toBe(CTX_A.contextId);
    expect(random?.contextLabel).toBe("random");
    expect(random?.contextId).toBe(CTX_B.contextId);
  });

  it("sorts merged results newest-first by timestamp", async () => {
    const old = makeRawMessage({ id: "old", timestamp: 100 });
    const mid = makeRawMessage({ id: "mid", timestamp: 200 });
    const newest = makeRawMessage({ id: "new", timestamp: 300 });

    mockSearchAllMessages.mockImplementation(
      ({ contextId }: { contextId: string }) => {
        if (contextId === CTX_A.contextId) return Promise.resolve(makeApiResponse([old, newest]));
        if (contextId === CTX_B.contextId) return Promise.resolve(makeApiResponse([mid]));
        return Promise.resolve(makeApiResponse([]));
      },
    );

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "query");
    });

    await waitFor(() => expect(result.current.searchResults.length).toBe(3));

    const ids = result.current.searchResults.map((m) => m.id);
    // newest first
    expect(ids[0]).toBe("new");
    expect(ids[1]).toBe("mid");
    expect(ids[2]).toBe("old");
  });

  it("sets searchTotalCount to the total number of merged results", async () => {
    const msgs = [makeRawMessage(), makeRawMessage(), makeRawMessage()];
    mockSearchAllMessages.mockImplementation(
      ({ contextId }: { contextId: string }) =>
        Promise.resolve(
          makeApiResponse(contextId === CTX_A.contextId ? msgs.slice(0, 2) : msgs.slice(2)),
        ),
    );

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A, CTX_B], "q");
    });

    await waitFor(() => expect(result.current.searchTotalCount).toBe(3));
  });

  it("sets searchQuery to the trimmed query", async () => {
    mockSearchAllMessages.mockResolvedValue(makeApiResponse([]));

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "  hello world  ");
    });

    expect(result.current.searchQuery).toBe("hello world");
  });

  it("clears state when query is empty", async () => {
    // Seed some results first
    mockSearchAllMessages.mockResolvedValue(
      makeApiResponse([makeRawMessage({ id: "seed" })]),
    );
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "seed");
    });
    await waitFor(() => expect(result.current.searchResults.length).toBe(1));

    // Now call with empty query
    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "");
    });

    expect(result.current.searchResults).toHaveLength(0);
    expect(result.current.searchTotalCount).toBe(0);
    expect(result.current.searchQuery).toBe("");
    // Should NOT have called the API for the empty query
    expect(mockSearchAllMessages).toHaveBeenCalledTimes(1);
  });

  it("clears state when context list is empty", async () => {
    mockSearchAllMessages.mockResolvedValue(makeApiResponse([]));
    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([], "hello");
    });

    expect(mockSearchAllMessages).not.toHaveBeenCalled();
    expect(result.current.searchResults).toHaveLength(0);
  });

  it("sets isSearching to true while searching and false when done", async () => {
    let resolveSearch!: (v: ReturnType<typeof makeApiResponse>) => void;
    const pending = new Promise<ReturnType<typeof makeApiResponse>>((r) => {
      resolveSearch = r;
    });
    mockSearchAllMessages.mockReturnValue(pending);

    const { result } = renderHook(() => useMessages());

    let searchDone = false;
    act(() => {
      void result.current.searchAllContexts([CTX_A], "query").then(() => {
        searchDone = true;
      });
    });

    await waitFor(() => expect(result.current.isSearching).toBe(true));

    await act(async () => {
      resolveSearch(makeApiResponse([]));
    });

    await waitFor(() => expect(searchDone).toBe(true));
    expect(result.current.isSearching).toBe(false);
  });

  it("captures API errors in searchError", async () => {
    mockSearchAllMessages.mockRejectedValue(new Error("Network timeout"));

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "query");
    });

    expect(result.current.searchError).toBe("Network timeout");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.searchResults).toHaveLength(0);
  });

  it("handles single-context search correctly", async () => {
    const msg = makeRawMessage({ id: "solo", text: "solo result", timestamp: 500 });
    mockSearchAllMessages.mockResolvedValue(makeApiResponse([msg]));

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "solo");
    });

    await waitFor(() => expect(result.current.searchResults.length).toBe(1));
    expect(result.current.searchResults[0].id).toBe("solo");
    expect(result.current.searchResults[0].contextId).toBe(CTX_A.contextId);
  });

  it("searchHasMore is always false (all results fetched at once)", async () => {
    const msgs = Array.from({ length: 5 }, (_, i) => makeRawMessage({ id: `m${i}` }));
    mockSearchAllMessages.mockResolvedValue(makeApiResponse(msgs));

    const { result } = renderHook(() => useMessages());

    await act(async () => {
      await result.current.searchAllContexts([CTX_A], "m");
    });

    await waitFor(() => expect(result.current.searchResults.length).toBe(5));
    // searchHasMore is derived from: searchOffset < searchTotalCount
    // Both should be equal (all results fetched)
    expect(result.current.searchOffset).toBe(result.current.searchTotalCount);
  });
});
