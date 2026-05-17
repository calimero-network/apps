/**
 * Unit tests for useSseSubscription.
 *
 * SseSubscriptionsClient is fully mocked — these tests verify the hook's
 * own logic: deduplication, diff-subscribe/unsubscribe, callback forwarding,
 * and cleanup on unmount.
 *
 * Run:  pnpm test src/hooks/useSseSubscription.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSseSubscription } from "./useSseSubscription";
import type { WebSocketEvent } from "../types/WebSocketTypes";

// ── Mock SseSubscriptionsClient ───────────────────────────────────────────────

// mockClient is hoisted so both vi.mock() and tests can reference the same object
const mockClient = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock("@calimero-network/mero-js", () => ({
  // vitest v4 requires a regular function (not an arrow) for constructor mocks
  SseClient: vi.fn(function (this: unknown) {
    return mockClient;
  }),
}));

vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: vi.fn().mockReturnValue("http://localhost:2428"),
}));

vi.mock("../api/meroJsClient", () => ({
  getJwt: () => "test-token",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(contextId = "ctx-1"): WebSocketEvent {
  return {
    contextId,
    type: "StateMutation",
    data: { events: [{ kind: "MessageSent" }] },
  };
}

/** Fire the callback registered via client.on('event', cb) */
function fireCallback(event: WebSocketEvent) {
  const calls = mockClient.on.mock.calls as Array<[string, (e: unknown) => void]>;
  const eventCall = calls.find((c) => c[0] === "event");
  if (!eventCall) throw new Error("No 'event' handler registered on SseClient");
  eventCall[1](event);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.subscribe.mockResolvedValue(undefined);
  mockClient.unsubscribe.mockResolvedValue(undefined);
});

// ── Connection ────────────────────────────────────────────────────────────────

describe("client lifecycle", () => {
  it("creates client and connects lazily on first subscribe", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1"]);
      await Promise.resolve(); // flush microtasks
    });

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.subscribe).toHaveBeenCalledWith(["ctx-1"]);
  });

  it("does not connect when contextIds list is empty", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts([]);
      await Promise.resolve();
    });

    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it("calls disconnect on unmount", async () => {
    const { result, unmount } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1"]);
      await Promise.resolve();
    });

    unmount();

    expect(mockClient.close).toHaveBeenCalledTimes(1);
  });

  it("connects only once across multiple subscribe calls", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2"]);
      await Promise.resolve();
    });

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe("subscribeToContexts — deduplication", () => {
  it("does not re-subscribe an already-subscribed context", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.subscribeToContexts(["ctx-1"]);
      await Promise.resolve();
    });

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  it("subscribes only new contexts on incremental update", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2"]);
      await Promise.resolve();
    });

    expect(mockClient.subscribe).toHaveBeenNthCalledWith(1, ["ctx-1"]);
    expect(mockClient.subscribe).toHaveBeenNthCalledWith(2, ["ctx-2"]);
  });

  it("filters falsy values from contextIds", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["", "ctx-1", ""]);
      await Promise.resolve();
    });

    expect(mockClient.subscribe).toHaveBeenCalledWith(["ctx-1"]);
  });
});

// ── Diff unsubscribe ──────────────────────────────────────────────────────────

describe("subscribeToContexts — diff unsubscribe", () => {
  it("unsubscribes contexts that dropped out of the list", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.subscribeToContexts(["ctx-2"]);
      await Promise.resolve();
    });

    expect(mockClient.unsubscribe).toHaveBeenCalledWith(["ctx-1"]);
  });

  it("unsubscribes all when list becomes empty", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.subscribeToContexts([]);
      await Promise.resolve();
    });

    expect(mockClient.unsubscribe).toHaveBeenCalledWith(expect.arrayContaining(["ctx-1", "ctx-2"]));
  });
});

// ── subscribeToContext (single) ───────────────────────────────────────────────

describe("subscribeToContext", () => {
  it("subscribes a single context", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });

    expect(mockClient.subscribe).toHaveBeenCalledWith(["ctx-1"]);
  });

  it("is a no-op when context is already subscribed", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });
    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for empty string", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContext("");
      await Promise.resolve();
    });

    expect(mockClient.subscribe).not.toHaveBeenCalled();
  });
});

// ── unsubscribeFromContext ────────────────────────────────────────────────────

describe("unsubscribeFromContext", () => {
  it("unsubscribes a subscribed context", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });
    await act(async () => {
      result.current.unsubscribeFromContext("ctx-1");
      await Promise.resolve();
    });

    expect(mockClient.unsubscribe).toHaveBeenCalledWith(["ctx-1"]);
    expect(result.current.getSubscribedContexts()).not.toContain("ctx-1");
  });

  it("is a no-op for an unsubscribed context", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.unsubscribeFromContext("ctx-1");
      await Promise.resolve();
    });

    expect(mockClient.unsubscribe).not.toHaveBeenCalled();
  });
});

// ── unsubscribeAll ────────────────────────────────────────────────────────────

describe("unsubscribeAll", () => {
  it("unsubscribes all tracked contexts", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2", "ctx-3"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.unsubscribeAll();
      await Promise.resolve();
    });

    expect(mockClient.unsubscribe).toHaveBeenCalledWith(
      expect.arrayContaining(["ctx-1", "ctx-2", "ctx-3"]),
    );
    expect(result.current.getSubscriptionCount()).toBe(0);
  });

  it("is a no-op when nothing is subscribed", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.unsubscribeAll();
      await Promise.resolve();
    });

    expect(mockClient.unsubscribe).not.toHaveBeenCalled();
  });
});

// ── State accessors ───────────────────────────────────────────────────────────

describe("state accessors", () => {
  it("getSubscribedContexts returns current subscriptions", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2"]);
      await Promise.resolve();
    });

    expect(result.current.getSubscribedContexts()).toEqual(
      expect.arrayContaining(["ctx-1", "ctx-2"]),
    );
    expect(result.current.getSubscriptionCount()).toBe(2);
    expect(result.current.isSubscribed()).toBe(true);
  });

  it("isSubscribed returns false before any subscription", () => {
    const { result } = renderHook(() => useSseSubscription(null));
    expect(result.current.isSubscribed()).toBe(false);
  });

  it("getSubscriptionCount reflects unsubscribe", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContexts(["ctx-1", "ctx-2"]);
      await Promise.resolve();
    });
    await act(async () => {
      result.current.unsubscribeFromContext("ctx-1");
      await Promise.resolve();
    });

    expect(result.current.getSubscriptionCount()).toBe(1);
  });
});

// ── Callback forwarding ───────────────────────────────────────────────────────

describe("event callback forwarding", () => {
  it("forwards SSE events to the provided callback", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSseSubscription(callback));

    // Trigger subscribe so the client (and addCallback) is initialized
    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });

    const event = makeEvent("ctx-1");
    act(() => fireCallback(event));

    expect(callback).toHaveBeenCalledWith(event);
  });

  it("uses the latest callback ref when the prop changes", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ cb }) => useSseSubscription(cb),
      { initialProps: { cb: first } },
    );

    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });

    rerender({ cb: second });

    act(() => fireCallback(makeEvent("ctx-1")));

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("does not crash when callback is null", async () => {
    const { result } = renderHook(() => useSseSubscription(null));

    await act(async () => {
      result.current.subscribeToContext("ctx-1");
      await Promise.resolve();
    });

    // Should not throw
    expect(() => act(() => fireCallback(makeEvent()))).not.toThrow();
  });
});
