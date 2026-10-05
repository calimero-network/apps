import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// The hook rides the SESSION's event stream (`mero.events`), one shared client
// per session. A fake stands in for it; a test drives its `connect` listeners.
// Hoisted: `vi.mock` factories run before the module body.
const { FakeSseClient, session } = vi.hoisted(() => {
  type Listener = (arg?: unknown) => void;
  class FakeSseClient {
    listeners: Record<string, Set<Listener>> = { connect: new Set(), event: new Set(), error: new Set() };
    sessionId: string | null = null;
    subscribed: string[] = [];
    unsubscribed: string[] = [];
    closed = false;
    on(name: string, h: Listener) { this.listeners[name]?.add(h); }
    off(name: string, h: Listener) { this.listeners[name]?.delete(h); }
    connect() { return Promise.resolve(); }
    subscribe(ids: string[]) { this.subscribed.push(...ids); return Promise.resolve(); }
    unsubscribe(ids: string[]) { this.unsubscribed.push(...ids); return Promise.resolve(); }
    close() { this.closed = true; }
    emitConnect(id = "session") { this.sessionId = id; for (const h of this.listeners.connect) h(id); }
    emitEvent(evt: unknown) { for (const h of this.listeners.event) h(evt); }
  }
  const session: { client: FakeSseClient } = { client: new FakeSseClient() };
  return { FakeSseClient, session };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ mero: { events: session.client } }),
}));

import { useSse } from "./useSse";

beforeEach(() => {
  session.client = new FakeSseClient();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSse", () => {
  it("subscribes the board on the session's stream and forwards only its events", () => {
    const onEvent = vi.fn();
    renderHook(() => useSse("ctx", onEvent));
    expect(session.client.subscribed).toEqual(["ctx"]);
    session.client.emitEvent({ contextId: "ctx", data: { kind: "ElementAdded" } });
    session.client.emitEvent({ contextId: "other", data: { kind: "nope" } });
    session.client.emitEvent({ groupId: "g", data: { kind: "membership" } });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ kind: "ElementAdded" });
  });
});

describe("useSse reconnect", () => {
  // A node restart drops the stream. SseClient reopens it and re-subscribes,
  // but whatever changed in the gap never arrives as an event, so the canvas
  // kept its pre-outage board until it was re-mounted.
  it("does not resync on the first connect — the page's own load covers it", () => {
    const onReconnect = vi.fn();
    renderHook(() => useSse("ctx", () => {}, onReconnect));
    session.client.emitConnect();
    vi.advanceTimersByTime(1000);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("resyncs on every later connect, after the re-subscribe", () => {
    const onReconnect = vi.fn();
    renderHook(() => useSse("ctx", () => {}, onReconnect));
    session.client.emitConnect();
    session.client.emitConnect();
    expect(onReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    session.client.emitConnect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  // The stream is shared: a second board mounts onto one that is already
  // open, so there is no initial connect to skip — the first it sees is a drop.
  it("treats the first connect as a reconnect when the stream was already open", () => {
    session.client.sessionId = "already-open";
    const onReconnect = vi.fn();
    renderHook(() => useSse("ctx", () => {}, onReconnect));
    session.client.emitConnect("new-session");
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("uses the latest callback without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSse("ctx", () => {}, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    expect(session.client.subscribed).toEqual(["ctx"]);
    session.client.emitConnect();
    session.client.emitConnect();
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("drops a pending resync and leaves the shared stream open when the page unmounts", () => {
    const onReconnect = vi.fn();
    const { unmount } = renderHook(() => useSse("ctx", () => {}, onReconnect));
    session.client.emitConnect();
    session.client.emitConnect();
    unmount();
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
    // Ours is unsubscribed; the session's stream is not closed under others.
    expect(session.client.unsubscribed).toEqual(["ctx"]);
    expect(session.client.closed).toBe(false);
    expect(session.client.listeners.connect.size).toBe(0);
    expect(session.client.listeners.event.size).toBe(0);
  });
});
