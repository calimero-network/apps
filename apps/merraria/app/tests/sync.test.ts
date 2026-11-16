import { describe, expect, it, vi } from "vitest";
import { STONE } from "../src/engine/tiles";
import { TileStore } from "../src/engine/world";
import { MerrariaClient } from "../src/generated/client";
import {
  FLUSH_MS,
  HEARTBEAT_IDLE_MS,
  HEARTBEAT_MOVING_MS,
  PLAYERS_POLL_MS,
  PRESENCE_MOVING_MS,
  PRESENCE_REFRESH_MS,
  quantize,
  RemotePlayer,
  SyncEngine,
  Transform,
  type PresenceChannel,
} from "../src/net/sync";
import { decodeSlice } from "../src/net/presence";

const T: Transform = { name: "P", x: 1, y: 2, dir: 1, sel: 0, action: "walking" };

function makeSync(overrides: Partial<Record<string, unknown>> = {}, presence: PresenceChannel | null = null) {
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
  // The generated client over a fake transport: every request reaches `exec`.
  const answer = async ({ method, args }: { method: string; args?: unknown }) => ({
    result: await exec(method, (args ?? {}) as Record<string, unknown>),
  });
  const client = new MerrariaClient({ apps: { call: answer, view: answer }, async *events() {} }, "w");
  const players: RemotePlayer[][] = [];
  const toasts: string[] = [];
  const sync = new SyncEngine(
    client,
    world,
    () => "me",
    {
      onPlayers: (p) => players.push(p),
      onToast: (m) => toasts.push(m),
    },
    presence,
  );
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
    expect(calls[0].method).toBe("setTiles");
    const edits = calls[0].args.edits as { x: number; t: number }[];
    expect(edits).toHaveLength(2);
    expect(edits.find((e) => e.x === 1)!.t).toBe(0);
  });

  it("requeues on failure without clobbering newer edits", async () => {
    const { sync } = makeSync({ setTiles: new Error("down") });
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
    const { sync, world, exec } = makeSync({ getOverrides: { items: [{ k: "1,2", t: STONE }], next: null } });
    sync.handleEvent({ kind: "TilesChanged", value: "peer" });
    await vi.waitFor(() => expect(exec).toHaveBeenCalled());
    await vi.waitFor(() => expect(world.getTile(1, 2)).toBe(STONE));
  });

  it("reads the edits once more, not once per event, for a burst of TilesChanged", async () => {
    const { sync, exec } = makeSync({ getOverrides: { items: [], next: null } });
    for (let i = 0; i < 5; i++) sync.handleEvent({ kind: "TilesChanged", value: "peer" });
    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("keeps locally-pending edits over remote state", async () => {
    const { sync, world } = makeSync({ getOverrides: { items: [{ k: "1,2", t: 4 }], next: null } });
    sync.queueEdit(1, 2, 9);
    world.setTile(1, 2, 9);
    await sync.pullOverrides();
    expect(world.getTile(1, 2)).toBe(9);
  });

  it("filters self and offline players from the roster", async () => {
    const mk = (id: string, online: boolean): RemotePlayer => ({ ...T, id, online, name: id });
    const { sync, players } = makeSync({
      getPlayers: [mk("me", true), mk("peer", true), mk("ghost", false)],
    });
    await sync.pullPlayers();
    expect(players[0].map((p) => p.id)).toEqual(["peer"]);
  });

  it("tick cadence: flush, heartbeat moving/idle, roster poll", () => {
    const { sync, exec } = makeSync({ getPlayers: [] });
    sync.queueEdit(1, 1, 1);
    sync.tick(FLUSH_MS, null, false);
    expect(exec).toHaveBeenCalledWith("setTiles", expect.anything());

    sync.tick(HEARTBEAT_MOVING_MS, T, true);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(1);
    sync.tick(HEARTBEAT_MOVING_MS, T, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(1);
    sync.tick(HEARTBEAT_IDLE_MS - HEARTBEAT_MOVING_MS, T, false);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat")).toHaveLength(2);

    expect(exec.mock.calls.filter((c) => c[0] === "getPlayers").length).toBeGreaterThan(0);
    void PLAYERS_POLL_MS;
  });

  it("quantize rounds transform to cm", () => {
    expect(quantize({ ...T, x: 1.2345 }).x).toBe(1.23);
  });

  it("active heartbeat runs at 500ms and carries the action", () => {
    expect(HEARTBEAT_MOVING_MS).toBe(500); // "save the location every 500ms"
    const { sync, exec } = makeSync({ getPlayers: [] });
    sync.tick(HEARTBEAT_MOVING_MS, { ...T, action: "mining" }, true);
    const hb = exec.mock.calls.find((c) => c[0] === "heartbeat")!;
    expect((hb[1] as { t: Transform }).t.action).toBe("mining");
  });
});

describe("SyncEngine.connect (a world not founded yet)", () => {
  // Right after a world's instance is created its `createWorld` may not have
  // landed yet, and the contract answers `NoWorld` (an app built before #702
  // reports v1's `Uninitialized`). Giving up on the first refusal left
  // the world unloaded for good.
  const uninitialized = () => new Error("NoWorld");

  it("keeps trying until the node answers, then resolves", async () => {
    vi.useFakeTimers();
    try {
      let joins = 0;
      const { sync, exec } = makeSync();
      exec.mockImplementation(async (method: string) => {
        if (method === "join" && ++joins < 3) throw uninitialized();
        return method === "getOverrides" ? { items: [], next: null } : method === "getPlayers" ? [] : null;
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
        if (method === "getOverrides" && ++reads === 1) throw uninitialized();
        return method === "getOverrides" ? { items: [], next: null } : method === "getPlayers" ? [] : null;
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

describe("SyncEngine over presence", () => {
  function makePresenceSync() {
    const published: unknown[] = [];
    let push: (players: RemotePlayer[]) => void = () => {};
    const stop = vi.fn();
    const presence: PresenceChannel = {
      publish: (slice) => published.push(slice),
      subscribe: (onPlayers) => {
        push = onPlayers;
        return stop;
      },
    };
    const made = makeSync({ getOverrides: { items: [], next: null }, getPlayers: [] }, presence);
    return { ...made, published, push: (p: RemotePlayer[]) => push(p), stop };
  }

  it("sends no contract heartbeat and polls no roster", () => {
    const { sync, exec, published } = makePresenceSync();
    for (let i = 0; i < 20; i++) sync.tick(PLAYERS_POLL_MS, { ...T, x: i }, true);
    expect(exec.mock.calls.filter((c) => c[0] === "heartbeat" || c[0] === "getPlayers")).toHaveLength(0);
    expect(published[0]).toMatchObject({ id: "me", x: 0, action: "walking" });
  });

  it("throttles a moving transform and refreshes an unchanged one", () => {
    const { sync, published } = makePresenceSync();
    sync.tick(PRESENCE_MOVING_MS, T, true);
    expect(published).toHaveLength(1);
    sync.tick(PRESENCE_MOVING_MS - 1, { ...T, x: 2 }, true);
    expect(published).toHaveLength(1);
    sync.tick(1, { ...T, x: 2 }, true);
    expect(published).toHaveLength(2);
    // Standing still: nothing until the refresh is due.
    sync.tick(PRESENCE_REFRESH_MS - 1, { ...T, x: 2 }, false);
    expect(published).toHaveLength(2);
    sync.tick(1, { ...T, x: 2 }, false);
    expect(published).toHaveLength(3);
  });

  it("takes the roster from presence, without itself", async () => {
    const { sync, players, push, exec } = makePresenceSync();
    await sync.connect("P", 1_000);
    push([
      { ...T, id: "me", online: true },
      { ...T, id: "peer", online: true },
    ]);
    expect(players.at(-1)!.map((p) => p.id)).toEqual(["peer"]);
    sync.handleEvent({ kind: "PlayerJoined", value: "peer" });
    expect(exec.mock.calls.filter((c) => c[0] === "getPlayers")).toHaveLength(0);
  });

  it("retracts its entry and stops following on leave", async () => {
    const { sync, published, stop } = makePresenceSync();
    await sync.connect("P", 1_000);
    await sync.leave();
    expect(stop).toHaveBeenCalled();
    expect(published.at(-1)).toBeNull();
  });
});

describe("decodeSlice", () => {
  const hex = (v: unknown) =>
    Array.from(new TextEncoder().encode(JSON.stringify(v)), (b) => b.toString(16).padStart(2, "0")).join("");

  it("reads a slice and skips a retracted or malformed one", () => {
    expect(decodeSlice(hex({ ...T, id: "acc" }))).toMatchObject({ id: "acc", x: 1, action: "walking" });
    expect(decodeSlice(hex({ ...T, id: "acc", action: "flying" }))?.action).toBe("idle");
    expect(decodeSlice(null)).toBeNull();
    expect(decodeSlice(hex(T))).toBeNull();
  });
});
