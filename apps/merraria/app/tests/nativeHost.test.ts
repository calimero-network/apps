import { describe, expect, it, vi } from "vitest";
import { frontTile, MeroBridge, NativeGameClient, nativeChannel } from "../src/native/host";

function bridgeWithLog() {
  const sent: Record<string, unknown>[] = [];
  const bridge = new MeroBridge((json) => sent.push(JSON.parse(json)));
  return { bridge, sent };
}

describe("native host bridge", () => {
  it("is off without an app channel", () => {
    expect(nativeChannel({})).toBeNull();
    expect(nativeChannel({ MeroBridgeAndroid: { postMessage: () => {} } })).not.toBeNull();
  });

  it("sends views as query and writes as execute, and resolves the app's answer", async () => {
    const { bridge, sent } = bridgeWithLog();
    const client = new NativeGameClient(bridge, "ctx");
    const read = client.exec("get_overrides", {});
    const write = client.exec("set_tiles", { edits: [{ x: 1, y: 2, t: 0 }], now: 5 });
    expect(sent).toEqual([
      { type: "request", id: 1, op: "query", method: "get_overrides", args: {} },
      { type: "request", id: 2, op: "execute", method: "set_tiles", args: { edits: [{ x: 1, y: 2, t: 0 }], now: 5 } },
    ]);
    bridge.receive(JSON.stringify({ type: "response", id: 2, ok: true, value: 1 }));
    bridge.receive({ type: "response", id: 1, ok: true, value: [{ k: "1,2", t: 0 }] });
    await expect(read).resolves.toEqual([{ k: "1,2", t: 0 }]);
    await expect(write).resolves.toBe(1);
  });

  it("keeps the rpc error shape boot() retries on", async () => {
    const { bridge } = bridgeWithLog();
    const client = new NativeGameClient(bridge, "ctx");
    const meta = client.fetchWorldMeta();
    bridge.receive({ type: "response", id: 1, ok: false, error: '{"type":"Uninitialized"}' });
    await expect(meta).rejects.toThrow('rpc world_meta: {"type":"Uninitialized"}');
  });

  it("learns its identity from join", async () => {
    const { bridge } = bridgeWithLog();
    const client = new NativeGameClient(bridge, "ctx");
    const joined = client.exec("join", { name: "Ada", now: 1 });
    bridge.receive({ type: "response", id: 1, ok: true, value: { id: "dev1", name: "Ada" } });
    await joined;
    await expect(client.resolveIdentity()).resolves.toBe("dev1");
  });

  it("routes app messages to the handlers and acks a leave", async () => {
    const { bridge, sent } = bridgeWithLog();
    const input = vi.fn();
    const target = vi.fn();
    const select = vi.fn();
    bridge.handlers = { input, target, select, leave: async () => {} };
    bridge.receive({ type: "input", move: -3, jump: true, jumpPressed: true, mine: false, place: true });
    bridge.receive({ type: "target", x: 120, y: 64 });
    bridge.receive({ type: "select", slot: 4 });
    bridge.receive("not json");
    bridge.receive({ type: "leave" });
    await Promise.resolve();
    await Promise.resolve();
    expect(input).toHaveBeenCalledWith({ move: -1, jump: true, jumpPressed: true, mine: false, place: true });
    expect(target).toHaveBeenCalledWith(120, 64);
    expect(select).toHaveBeenCalledWith(4);
    expect(sent).toContainEqual({ type: "left" });
  });

  it("turns every relay event into a tile re-read", async () => {
    const { bridge } = bridgeWithLog();
    const client = new NativeGameClient(bridge, "ctx");
    const onEvent = vi.fn();
    const onReconnect = vi.fn();
    await client.subscribe(onEvent, onReconnect);
    bridge.receive({ type: "event", kind: "StateMutation" });
    bridge.receive({ type: "event", kind: "reconnected" });
    expect(onEvent).toHaveBeenCalledWith({ kind: "TilesChanged", value: null });
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});

describe("frontTile", () => {
  const world = (solid: Set<string>) => (x: number, y: number) => (solid.has(`${x},${y}`) ? 1 : 0);
  const player = { x: 10.5, y: 20, facing: 1 };

  it("prefers the block at the feet, then the head, then the empty feet spot", () => {
    expect(frontTile(player, world(new Set(["11,19", "11,18"])))).toEqual({ x: 11, y: 19 });
    expect(frontTile(player, world(new Set(["11,18"])))).toEqual({ x: 11, y: 18 });
    expect(frontTile(player, world(new Set()))).toEqual({ x: 11, y: 19 });
    expect(frontTile({ ...player, facing: -1 }, world(new Set()))).toEqual({ x: 9, y: 19 });
  });
});
