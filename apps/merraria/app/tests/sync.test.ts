import { describe, expect, it, vi } from "vitest";
import { STONE } from "../src/engine/tiles";
import { TileStore } from "../src/engine/world";
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

const T: Transform = { name: "P", x: 1, y: 2, dir: 1, sel: 0, action: "walking" };

function makeSync(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const world = new TileStore();
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

describe("SyncEngine (merraria)", () => {
  it("coalesces edits per tile key, LWW", async () => {
    const { sync, calls } = makeSync();
    sync.queueEdit(1, 2, 5);
    sync.queueEdit(1, 2, 0);
    sync.queueEdit(4, 4, 7);
    await sync.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("set_tiles");
    const edits = calls[0].args.edits as { x: number; t: number }[];
    expect(edits).toHaveLength(2);
    expect(edits.find((e) => e.x === 1)!.t).toBe(0);
  });

  it("requeues on failure without clobbering newer edits", async () => {
    const { sync } = makeSync({ set_tiles: new Error("down") });
    sync.queueEdit(1, 2, 5);
    const p = sync.flush();
    sync.queueEdit(1, 2, 9);
    await p;
    expect(sync.pending.get("1,2")!.t).toBe(9);
  });

  it("ignores its own TilesChanged echo", () => {
    const { sync, exec } = makeSync();
    sync.handleEvent({ kind: "TilesChanged", value: "me" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("applies a peer's overrides on TilesChanged", async () => {
    const { sync, world, exec } = makeSync({ get_overrides: [{ k: "1,2", t: STONE }] });
    sync.handleEvent({ kind: "TilesChanged", value: "peer" });
    await vi.waitFor(() => expect(exec).toHaveBeenCalled());
    await vi.waitFor(() => expect(world.getTile(1, 2)).toBe(STONE));
  });

  it("keeps locally-pending edits over remote state", async () => {
    const { sync, world } = makeSync({ get_overrides: [{ k: "1,2", t: 4 }] });
    sync.queueEdit(1, 2, 9);
    world.setTile(1, 2, 9);
    await sync.pullOverrides();
    expect(world.getTile(1, 2)).toBe(9);
  });

  it("filters self and offline players from the roster", async () => {
    const mk = (id: string, online: boolean): RemotePlayer => ({ ...T, id, online, name: id });
    const { sync, players } = makeSync({
      get_players: [mk("me", true), mk("peer", true), mk("ghost", false)],
    });
    await sync.pullPlayers();
    expect(players[0].map((p) => p.id)).toEqual(["peer"]);
  });

  it("tick cadence: flush, heartbeat moving/idle, roster poll", () => {
    const { sync, exec } = makeSync({ get_players: [] });
    sync.queueEdit(1, 1, 1);
    sync.tick(FLUSH_MS, null, false);
    expect(exec).toHaveBeenCalledWith("set_tiles", expect.anything());

    sync.tick(HEARTBEAT_MOVING_MS, T, true);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(1);
    sync.tick(HEARTBEAT_MOVING_MS, T, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(1);
    sync.tick(HEARTBEAT_IDLE_MS - HEARTBEAT_MOVING_MS, T, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(2);

    expect(exec.mock.calls.filter((c) => c[0] === "get_players").length).toBeGreaterThan(0);
    void PLAYERS_POLL_MS;
  });

  it("quantize rounds transform to cm", () => {
    expect(quantize({ ...T, x: 1.2345 }).x).toBe(1.23);
  });

  it("active heartbeat runs at 500ms and carries the action", () => {
    expect(HEARTBEAT_MOVING_MS).toBe(500); // "save the location every 500ms"
    const { sync, exec } = makeSync({ get_players: [] });
    sync.tick(HEARTBEAT_MOVING_MS, { ...T, action: "mining" }, true);
    const hb = exec.mock.calls.find((c) => c[0] === "heartbeat")!;
    expect((hb[1] as { t: Transform }).t.action).toBe("mining");
  });
});

describe("SyncEngine.connect (a world just joined from an invite)", () => {
  // Right after a join the node may not hold the world's state yet, and the
  // contract answers `Uninitialized`. CI's merraria journey hit exactly this:
  // the first `join` failed, the game gave up, never reported the world loaded,
  // and the invitation dialog sat on "Syncing…" until the journey timed out.
  const uninitialized = () => new Error('{"type":"Uninitialized"}');

  it("keeps trying until the node answers, then resolves", async () => {
    vi.useFakeTimers();
    try {
      let joins = 0;
      const { sync, exec } = makeSync();
      exec.mockImplementation(async (method: string) => {
        if (method === "join" && ++joins < 3) throw uninitialized();
        return method === "get_overrides" || method === "get_players" ? [] : null;
      });

      let connected: boolean | undefined;
      void sync.connect("P", 1_000).then((v) => (connected = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(connected).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(connected).toBe(true);
      expect(joins).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count a world whose edits could not be read as loaded", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const { sync, exec } = makeSync();
      exec.mockImplementation(async (method: string) => {
        if (method === "get_overrides" && ++reads === 1) throw uninitialized();
        return method === "get_overrides" || method === "get_players" ? [] : null;
      });

      let connected: boolean | undefined;
      void sync.connect("P", 1_000).then((v) => (connected = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(connected).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(connected).toBe(true);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops once the world is no longer the one on screen", async () => {
    vi.useFakeTimers();
    try {
      let current = true;
      const { sync, exec } = makeSync();
      exec.mockImplementation(async () => {
        throw uninitialized();
      });

      let connected: boolean | undefined;
      void sync.connect("P", 1_000, () => current).then((v) => (connected = v));
      await vi.advanceTimersByTimeAsync(0);
      current = false;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(connected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
