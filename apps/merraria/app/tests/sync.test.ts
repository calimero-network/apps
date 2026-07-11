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

const T: Transform = { name: "P", x: 1, y: 2, dir: 1, sel: 0 };

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
});
