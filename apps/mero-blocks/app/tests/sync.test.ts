import { describe, expect, it, vi } from "vitest";
import { STONE } from "../src/engine/blocks";
import { WorldStore } from "../src/engine/world";
import {
  FLUSH_MS,
  HEARTBEAT_IDLE_MS,
  HEARTBEAT_MOVING_MS,
  PLAYERS_POLL_MS,
  quantize,
  RemotePlayer,
  SyncEngine,
  Transform,
} from "../src/net/sync";

const T: Transform = { name: "P", x: 1, y: 2, z: 3, yaw: 0, pitch: 0, sel: 0 };

function makeSync(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const world = new WorldStore();
  const exec = vi.fn(async (method: string, args: Record<string, unknown>) => {
    calls.push({ method, args });
    if (method in overrides) {
      const v = overrides[method];
      if (v instanceof Error) throw v;
      return v;
    }
    return null;
  });
  const players: RemotePlayer[][] = [];
  const toasts: string[] = [];
  const sync = new SyncEngine(exec as never, world, () => "me", {
    onPlayers: (p) => players.push(p),
    onToast: (m) => toasts.push(m),
  });
  return { sync, world, exec, calls, players, toasts };
}

describe("SyncEngine outbound edits", () => {
  it("coalesces edits per block key, last write wins", async () => {
    const { sync, calls } = makeSync();
    sync.queueEdit(1, 2, 3, 5);
    sync.queueEdit(1, 2, 3, 0); // same block again
    sync.queueEdit(4, 4, 4, 7);
    await sync.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("set_blocks");
    const edits = calls[0].args.edits as { x: number; b: number }[];
    expect(edits).toHaveLength(2);
    expect(edits.find((e) => e.x === 1)!.b).toBe(0);
    expect(typeof calls[0].args.now).toBe("number");
  });

  it("does nothing when the queue is empty", async () => {
    const { sync, exec } = makeSync();
    await sync.flush();
    expect(exec).not.toHaveBeenCalled();
  });

  it("requeues the batch on failure without clobbering newer edits", async () => {
    const { sync } = makeSync({ set_blocks: new Error("network down") });
    sync.queueEdit(1, 2, 3, 5);
    const flushPromise = sync.flush();
    sync.queueEdit(1, 2, 3, 9); // player edits the same block while in flight
    await flushPromise;
    expect(sync.pending.get("1,2,3")!.b).toBe(9); // newer edit survived
  });

  it("clears pending after a successful flush", async () => {
    const { sync } = makeSync();
    sync.queueEdit(1, 2, 3, 5);
    await sync.flush();
    expect(sync.pending.size).toBe(0);
  });
});

describe("SyncEngine inbound events", () => {
  it("ignores its own BlocksChanged echo", () => {
    const { sync, exec } = makeSync();
    sync.handleEvent({ kind: "BlocksChanged", value: "me" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("pulls overrides on a peer's BlocksChanged", async () => {
    const { sync, world, exec } = makeSync({
      get_overrides: [{ k: "1,2,3", b: STONE }],
    });
    sync.handleEvent({ kind: "BlocksChanged", value: "peer" });
    await vi.waitFor(() => expect(exec).toHaveBeenCalled());
    await vi.waitFor(() => expect(world.getBlock(1, 2, 3)).toBe(STONE));
  });

  it("does not clobber a locally-pending edit with a remote override", async () => {
    const { sync, world } = makeSync();
    sync.queueEdit(1, 2, 3, 9); // unsent local edit
    world.setBlock(1, 2, 3, 9);
    await syncPull(sync, [{ k: "1,2,3", b: 4 }]);
    expect(world.getBlock(1, 2, 3)).toBe(9);
  });

  it("toasts and refreshes the roster on join/leave", async () => {
    const { sync, toasts } = makeSync({ get_players: [] });
    sync.handleEvent({ kind: "PlayerJoined", value: "peer" });
    sync.handleEvent({ kind: "PlayerLeft", value: "peer" });
    expect(toasts).toEqual(["A player joined", "A player left"]);
  });

  it("does not toast for its own join", () => {
    const { sync, toasts } = makeSync({ get_players: [] });
    sync.handleEvent({ kind: "PlayerJoined", value: "me" });
    expect(toasts).toEqual([]);
  });
});

async function syncPull(sync: SyncEngine, entries: { k: string; b: number }[]) {
  // reach into the engine with a one-off exec for pullOverrides
  const anySync = sync as unknown as { exec: (m: string, a: unknown) => Promise<unknown> };
  const orig = anySync.exec;
  anySync.exec = async () => entries;
  await sync.pullOverrides();
  anySync.exec = orig;
}

describe("SyncEngine roster", () => {
  it("filters out self and offline players", async () => {
    const mk = (id: string, online: boolean): RemotePlayer => ({
      ...T,
      id,
      online,
      name: id,
    });
    const { sync, players } = makeSync({
      get_players: [mk("me", true), mk("peer", true), mk("ghost", false)],
    });
    await sync.pullPlayers();
    expect(players[0].map((p) => p.id)).toEqual(["peer"]);
  });
});

describe("SyncEngine tick cadence", () => {
  it("flushes queued edits after FLUSH_MS", () => {
    const { sync, exec } = makeSync();
    sync.queueEdit(1, 1, 1, 1);
    sync.tick(FLUSH_MS - 1, null, false);
    expect(exec).not.toHaveBeenCalled();
    sync.tick(1, null, false);
    expect(exec).toHaveBeenCalledWith("set_blocks", expect.anything());
  });

  it("heartbeats at 1s while moving, 3s while idle", () => {
    const { sync, exec } = makeSync();
    // moving: fires at HEARTBEAT_MOVING_MS
    sync.tick(HEARTBEAT_MOVING_MS, T, true);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(1);
    // idle: the same elapsed time does NOT fire
    sync.tick(HEARTBEAT_MOVING_MS, T, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(1);
    // …until the idle interval is reached
    sync.tick(HEARTBEAT_IDLE_MS - HEARTBEAT_MOVING_MS, T, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(2);
  });

  it("polls players every PLAYERS_POLL_MS", () => {
    const { sync, exec } = makeSync({ get_players: [] });
    sync.tick(PLAYERS_POLL_MS, null, false);
    expect(exec.mock.calls.filter((c) => c[0] === "get_players")).toHaveLength(1);
  });

  it("sends no heartbeat without a transform", () => {
    const { sync, exec } = makeSync();
    sync.tick(HEARTBEAT_IDLE_MS * 2, null, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(0);
  });
});

describe("quantize", () => {
  it("rounds position to cm and angles to mrad", () => {
    const q = quantize({ ...T, x: 1.23456, yaw: 0.123456 });
    expect(q.x).toBe(1.23);
    expect(q.yaw).toBe(0.123);
  });
});
