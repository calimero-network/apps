import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SseClient } from "@calimero-network/mero-js";
import { GameClient } from "../src/net/client";
import { resetSession, updateSession } from "../src/net/session";
import type { Transport } from "../src/net/transport";

// One fake SseClient per transport; a test drives its `connect` listeners.
type Listener = (arg?: unknown) => void;
class FakeSseClient {
  listeners: Record<string, Set<Listener>> = { connect: new Set(), event: new Set(), error: new Set() };
  closed = false;
  on(name: string, h: Listener) { this.listeners[name]?.add(h); }
  off(name: string, h: Listener) { this.listeners[name]?.delete(h); }
  connect() { return Promise.resolve(); }
  subscribe() { return Promise.resolve(); }
  close() { this.closed = true; }
  emitConnect() { for (const h of this.listeners.connect) h("session"); }
}

/** a transport whose only live part is the event stream */
function fakeTransport(sse: FakeSseClient): Promise<Transport> {
  return Promise.resolve({
    kind: "node",
    admin: {} as Transport["admin"],
    rpc: {} as Transport["rpc"],
    events: () => sse as unknown as SseClient,
    myId: async () => "me",
    resolveApplicationId: async () => null,
    close: () => {},
  });
}

beforeEach(() => {
  localStorage.clear();
  resetSession();
  updateSession({ kind: "node", nodeUrl: "http://localhost:2428", contextId: "ctx" });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// A node restart drops the stream. SseClient reopens it and re-subscribes,
// but edits made in the gap never arrive as events — and the world is only
// pulled on an event — so they never showed up until a reload.
describe("GameClient reconnect", () => {
  it("does not call onReconnect on the first connect", async () => {
    const sse = new FakeSseClient();
    const onReconnect = vi.fn();
    await new GameClient(fakeTransport(sse)).subscribe(() => {}, onReconnect);
    sse.emitConnect();
    vi.advanceTimersByTime(1000);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("calls onReconnect on every later connect, after the re-subscribe", async () => {
    const sse = new FakeSseClient();
    const onReconnect = vi.fn();
    await new GameClient(fakeTransport(sse)).subscribe(() => {}, onReconnect);
    sse.emitConnect();
    sse.emitConnect();
    expect(onReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    sse.emitConnect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("drops a pending resync on close", async () => {
    const sse = new FakeSseClient();
    const onReconnect = vi.fn();
    const client = new GameClient(fakeTransport(sse));
    await client.subscribe(() => {}, onReconnect);
    sse.emitConnect();
    sse.emitConnect();
    client.close();
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(sse.closed).toBe(true);
  });

  it("subscribes to nothing when the session has no stream (an account with no relay)", async () => {
    const t = fakeTransport(new FakeSseClient()).then((base) => ({ ...base, events: () => null }));
    const onReconnect = vi.fn();
    await new GameClient(t).subscribe(() => {}, onReconnect);
    vi.advanceTimersByTime(1000);
    expect(onReconnect).not.toHaveBeenCalled();
  });
});
