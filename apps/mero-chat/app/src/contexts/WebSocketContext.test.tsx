import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { WebSocketProvider, useWebSocket, useWebSocketEvents } from "./WebSocketContext";
import type { WebSocketEvent } from "../types/WebSocketTypes";

// Capture the event-callback passed to useSubscription so tests can fire events directly.
let capturedEventCallback: ((event: WebSocketEvent) => void) | null = null;

vi.mock("@calimero-network/mero-react", () => ({
  useSubscription: vi.fn((_contextIds: unknown, callback: unknown) => {
    capturedEventCallback = callback as (event: WebSocketEvent) => void;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  capturedEventCallback = null;
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <WebSocketProvider>{children}</WebSocketProvider>;
}

function makeEvent(contextId = "ctx-1"): WebSocketEvent {
  return {
    contextId,
    type: "StateMutation",
    data: { events: [{ kind: "MessageSent" }] },
  };
}

async function fireEvent(event: WebSocketEvent) {
  if (!capturedEventCallback) throw new Error("eventCallback not captured");
  await act(() => capturedEventCallback!(event));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WebSocketProvider", () => {
  it("renders children without throwing", () => {
    const { getByText } = render(
      <WebSocketProvider>
        <span>child</span>
      </WebSocketProvider>,
    );
    expect(getByText("child")).toBeTruthy();
  });

  it("exposes subscription methods via useWebSocket", () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    expect(typeof result.current.subscribeToContexts).toBe("function");
    expect(typeof result.current.subscribeToContext).toBe("function");
    expect(typeof result.current.unsubscribeFromContext).toBe("function");
    expect(typeof result.current.unsubscribeAll).toBe("function");
  });
});

describe("useWebSocket", () => {
  it("throws when used outside WebSocketProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useWebSocket())).toThrow(
      "useWebSocket must be used within WebSocketProvider",
    );
    spy.mockRestore();
  });
});

describe("addEventListener / removeEventListener", () => {
  it("dispatches events to a registered listener", async () => {
    const listener = vi.fn();
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    act(() => result.current.addEventListener(listener));
    await fireEvent(makeEvent());

    expect(listener).toHaveBeenCalledWith(makeEvent());
  });

  it("dispatches to multiple listeners independently", async () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    act(() => {
      result.current.addEventListener(l1);
      result.current.addEventListener(l2);
    });
    await fireEvent(makeEvent("ctx-2"));

    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it("does not call a listener after removeEventListener", async () => {
    const listener = vi.fn();
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    act(() => result.current.addEventListener(listener));
    act(() => result.current.removeEventListener(listener));
    await fireEvent(makeEvent());

    expect(listener).not.toHaveBeenCalled();
  });

  it("an error in one listener does not prevent others from being called", async () => {
    const badListener = vi.fn().mockImplementation(() => {
      throw new Error("listener crashed");
    });
    const goodListener = vi.fn();
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    act(() => {
      result.current.addEventListener(badListener);
      result.current.addEventListener(goodListener);
    });
    // Should not throw despite the bad listener
    await fireEvent(makeEvent());

    expect(goodListener).toHaveBeenCalledTimes(1);
  });
});

describe("useWebSocketEvents", () => {
  it("registers listener and receives events", async () => {
    const listener = vi.fn();
    renderHook(() => useWebSocketEvents(listener), { wrapper });

    await fireEvent(makeEvent());

    expect(listener).toHaveBeenCalledWith(makeEvent());
  });

  it("removes listener on unmount", async () => {
    const listener = vi.fn();
    const { unmount } = renderHook(() => useWebSocketEvents(listener), { wrapper });

    unmount();
    await fireEvent(makeEvent());

    expect(listener).not.toHaveBeenCalled();
  });

  it("uses the latest listener reference when callback prop changes", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let active = first;

    const { rerender } = renderHook(() => useWebSocketEvents(active), { wrapper });

    active = second;
    rerender();
    await fireEvent(makeEvent());

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
