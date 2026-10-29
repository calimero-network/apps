// The page half of the bridge (src/bridge.ts) and the touch stick maths (src/controls.ts). The app
// halves are pinned by the Swift `BridgeCodecTests` and the Kotlin `BridgeCodecTest`.
import { describe, expect, it, vi } from "vitest";
import { detectHost, MeroBridge, type AppMessage } from "../src/bridge";
import { STICK_DEADZONE, STICK_RADIUS, stickVector } from "../src/controls";

function rig() {
  const posted: Record<string, unknown>[] = [];
  const messages: AppMessage[] = [];
  const bridge = new MeroBridge({ post: (json) => posted.push(JSON.parse(json)) }, (m) => messages.push(m));
  return { bridge, posted, messages };
}

describe("MeroBridge", () => {
  it("posts a call and resolves it with the app's answer", async () => {
    const { bridge, posted } = rig();
    const answer = bridge.query("get_players", { now: 1730000000 });
    expect(posted).toEqual([{ id: 1, op: "query", method: "get_players", args: { now: 1730000000 } }]);
    bridge.receive(JSON.stringify({ type: "result", id: 1, ok: true, result: [{ id: "a", online: true }] }));
    await expect(answer).resolves.toEqual([{ id: "a", online: true }]);
    expect(bridge.inFlight).toBe(0);
  });

  it("rejects a call the app refused, with its sentence", async () => {
    const { bridge } = rig();
    const answer = bridge.execute("init", {});
    bridge.receive(JSON.stringify({ type: "result", id: 1, ok: false, error: "The game may not call init." }));
    await expect(answer).rejects.toThrow("The game may not call init.");
  });

  it("sends views through query and everything else through execute", () => {
    const { bridge, posted } = rig();
    void bridge.exec("world_meta", {});
    void bridge.exec("get_overrides", {});
    void bridge.exec("set_blocks", { edits: [], now: 1 });
    void bridge.exec("heartbeat", { t: {}, now: 1 });
    expect(posted.map((p) => p.op)).toEqual(["query", "query", "execute", "execute"]);
  });

  it("hands every other message to the game and ignores junk", () => {
    const { bridge, messages } = rig();
    bridge.receive(JSON.stringify({ type: "start", contextId: "c", myId: "m", name: "Ana", worldName: "W", sensitivity: 1 }));
    bridge.receive(JSON.stringify({ type: "event", kind: "StateMutation" }));
    bridge.receive("not json");
    bridge.receive(JSON.stringify({ type: "result", id: 99, ok: true, result: null }));
    expect(messages.map((m) => m.type)).toEqual(["start", "event"]);
  });

  it("gives up on a call the app never answers", async () => {
    vi.useFakeTimers();
    const { bridge } = rig();
    const answer = bridge.query("world_meta", {});
    vi.advanceTimersByTime(30_001);
    await expect(answer).rejects.toThrow("no answer from the app");
    vi.useRealTimers();
  });

  it("refuses calls outside the app", async () => {
    const bridge = new MeroBridge(null, () => {});
    await expect(bridge.query("world_meta", {})).rejects.toThrow("runs inside the app");
  });

  it("finds the iOS and Android hosts", () => {
    const ios = vi.fn();
    detectHost({ webkit: { messageHandlers: { meroBlocks: { postMessage: ios } } } })!.post("x");
    expect(ios).toHaveBeenCalledWith("x");
    const android = vi.fn();
    detectHost({ MeroBlocksAndroid: { postMessage: android } })!.post("y");
    expect(android).toHaveBeenCalledWith("y");
    expect(detectHost({})).toBeNull();
  });
});

describe("stickVector", () => {
  it("is still inside the dead zone and full at the rim", () => {
    expect(stickVector(0, 0)).toEqual({ x: 0, y: 0 });
    expect(stickVector(STICK_RADIUS * STICK_DEADZONE * 0.5, 0)).toEqual({ x: 0, y: 0 });
    const up = stickVector(0, -STICK_RADIUS * 2);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    const right = stickVector(STICK_RADIUS / 2, 0);
    expect(right.x).toBeCloseTo(0.5);
    expect(right.y).toBeCloseTo(0);
  });
});
