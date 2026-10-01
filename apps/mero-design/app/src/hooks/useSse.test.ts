import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// One fake SseClient per hook mount; a test drives its `connect` listeners.
// Hoisted: `vi.mock` factories run before the module body.
const { clients, FakeSseClient } = vi.hoisted(() => {
  type Listener = (arg?: unknown) => void;
  const clients: InstanceType<typeof FakeSseClient>[] = [];
  class FakeSseClient {
    listeners: Record<string, Set<Listener>> = { connect: new Set(), event: new Set(), error: new Set() };
    closed = false;
    constructor() { clients.push(this); }
    on(name: string, h: Listener) { this.listeners[name]?.add(h); }
    off(name: string, h: Listener) { this.listeners[name]?.delete(h); }
    connect() { return Promise.resolve(); }
    subscribe() { return Promise.resolve(); }
    close() { this.closed = true; }
    emitConnect() { for (const h of this.listeners.connect) h("session"); }
  }
  return { clients, FakeSseClient };
});

vi.mock("@calimero-network/mero-js", () => ({ SseClient: FakeSseClient }));
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ nodeUrl: "http://localhost:2428" }),
}));
vi.mock("../api/rpc", () => ({ getJwt: () => "token" }));

import { useSse } from "./useSse";

beforeEach(() => {
  clients.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSse reconnect", () => {
  // A node restart drops the stream. SseClient reopens it and re-subscribes,
  // but whatever changed in the gap never arrives as an event, so the canvas
  // kept its pre-outage board until it was re-mounted.
  it("does not resync on the first connect — the page's own load covers it", () => {
    const onReconnect = vi.fn();
    renderHook(() => useSse("ctx", () => {}, onReconnect));
    clients[0].emitConnect();
    vi.advanceTimersByTime(1000);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("resyncs on every later connect, after the re-subscribe", () => {
    const onReconnect = vi.fn();
    renderHook(() => useSse("ctx", () => {}, onReconnect));
    clients[0].emitConnect();
    clients[0].emitConnect();
    expect(onReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    clients[0].emitConnect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without reopening the stream", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSse("ctx", () => {}, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    expect(clients).toHaveLength(1);
    clients[0].emitConnect();
    clients[0].emitConnect();
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("drops a pending resync when the page unmounts", () => {
    const onReconnect = vi.fn();
    const { unmount } = renderHook(() => useSse("ctx", () => {}, onReconnect));
    clients[0].emitConnect();
    clients[0].emitConnect();
    unmount();
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(clients[0].closed).toBe(true);
    expect(clients[0].listeners.connect.size).toBe(0);
  });
});
