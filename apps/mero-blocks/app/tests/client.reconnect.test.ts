import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// One fake SseClient per subscribe(); a test drives its `connect` listeners.
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

vi.mock("@calimero-network/mero-js", () => ({
  SseClient: FakeSseClient,
  AuthRevokedError: class AuthRevokedError extends Error {},
}));
vi.mock("../src/net/session", () => ({
  getSession: () => ({ nodeUrl: "http://localhost:2428", contextId: "ctx" }),
  getAccessToken: () => "token",
  clearSession: () => {},
}));

import { GameClient } from "../src/net/client";

beforeEach(() => {
  clients.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// A node restart drops the stream. SseClient reopens it and re-subscribes,
// but edits made in the gap never arrive as events — and the world is only
// pulled on an event — so they never showed up until a reload.
describe("GameClient reconnect", () => {
  it("does not call onReconnect on the first connect", () => {
    const onReconnect = vi.fn();
    new GameClient().subscribe(() => {}, onReconnect);
    clients[0].emitConnect();
    vi.advanceTimersByTime(1000);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("calls onReconnect on every later connect, after the re-subscribe", () => {
    const onReconnect = vi.fn();
    new GameClient().subscribe(() => {}, onReconnect);
    clients[0].emitConnect();
    clients[0].emitConnect();
    expect(onReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    clients[0].emitConnect();
    vi.advanceTimersByTime(500);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("drops a pending resync on close", () => {
    const onReconnect = vi.fn();
    const client = new GameClient();
    client.subscribe(() => {}, onReconnect);
    clients[0].emitConnect();
    clients[0].emitConnect();
    client.close();
    vi.advanceTimersByTime(500);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(clients[0].closed).toBe(true);
  });
});
