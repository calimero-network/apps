import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReconnectResync, type ConnectSource } from "./useReconnectResync";

/** A stand-in for `SseClient`'s `connect` notifications. */
function fakeStream() {
  const handlers = new Set<(id: string) => void>();
  const events: ConnectSource = {
    on: (_, h) => { handlers.add(h); },
    off: (_, h) => { handlers.delete(h); },
  };
  return {
    events,
    handlers,
    connect: () => { for (const h of handlers) h("session"); },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useReconnectResync", () => {
  it("does not resync on the first connect", () => {
    // The initial load is already fetching. Resyncing on top of it would
    // double every startup.
    const s = fakeStream();
    const onReconnect = vi.fn();
    renderHook(() => useReconnectResync(s.events, false, onReconnect));

    s.connect();
    vi.advanceTimersByTime(1000);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("resyncs when the stream comes back, after the re-subscribe", () => {
    const s = fakeStream();
    const onReconnect = vi.fn();
    renderHook(() => useReconnectResync(s.events, false, onReconnect));

    s.connect();
    s.connect();
    expect(onReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("resyncs while isOnline never changed — the desktop's clean stream end", () => {
    // Tauri's SSE proxy closes a dropped stream without an error, so
    // `isOnline` stays true across the whole outage. Only `connect` says the
    // stream came back.
    const s = fakeStream();
    const onReconnect = vi.fn();
    const { rerender } = renderHook(
      ({ online }) => useReconnectResync(s.events, online, onReconnect),
      { initialProps: { online: true } },
    );

    rerender({ online: true });
    s.connect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("resyncs once per drop, not once per render", () => {
    // The caller's callback is rebuilt every render in practice. If the
    // listener depended on it, it would be re-armed each time.
    const s = fakeStream();
    let onReconnect = vi.fn();
    const { rerender } = renderHook(
      () => useReconnectResync(s.events, true, onReconnect),
    );

    s.connect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);

    onReconnect = vi.fn();
    rerender();
    rerender();
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(s.handlers.size).toBe(1);
  });

  it("resyncs again after a second drop", () => {
    // A flaky connection drops more than once, and each hole needs filling.
    const s = fakeStream();
    const onReconnect = vi.fn();
    renderHook(() => useReconnectResync(s.events, true, onReconnect));

    s.connect();
    vi.advanceTimersByTime(500);
    s.connect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("coalesces a flapping stream into one resync", () => {
    const s = fakeStream();
    const onReconnect = vi.fn();
    renderHook(() => useReconnectResync(s.events, true, onReconnect));

    s.connect();
    vi.advanceTimersByTime(200);
    s.connect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("stops listening, and drops a pending resync, on unmount", () => {
    const s = fakeStream();
    const onReconnect = vi.fn();
    const { unmount } = renderHook(() => useReconnectResync(s.events, true, onReconnect));

    s.connect();
    unmount();
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(s.handlers.size).toBe(0);
  });

  it("does nothing without a stream", () => {
    const onReconnect = vi.fn();
    renderHook(() => useReconnectResync(null, true, onReconnect));
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
  });
});
