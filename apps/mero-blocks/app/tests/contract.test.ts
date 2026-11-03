// The typed wrapper (src/net/blocks.ts) against the contract it calls: the
// method lists and every argument name must be exactly the committed
// logic/res/abi.json's, and the wire conversions (u64 as decimal strings) must
// hold in both directions.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, INIT_PARAMS, PARAMS, VIEWS, blocks, initArgs, playerId } from "../src/net/blocks";

interface AbiMethod {
  kind: string;
  params: [string, string][];
}
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, AbiMethod>;
  events: Record<string, Record<string, string>>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

describe("the wrapper covers the contract's ABI", () => {
  it("lists exactly the ABI's calls and views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
  });

  it("names every argument as the ABI does", () => {
    for (const [method, params] of Object.entries(PARAMS)) {
      expect(abi.methods[method]?.params.map(([n]) => n), method).toEqual([...params]);
    }
    expect(abi.methods.init?.params.map(([n]) => n)).toEqual([...INIT_PARAMS]);
  });

  it("knows the events the game reacts to, each carrying the avatar id", () => {
    for (const kind of ["BlocksChanged", "PlayerJoined", "PlayerLeft"]) {
      expect(abi.events[kind]).toEqual({ id: "string" });
    }
  });
});

function fakeClient(answers: Record<string, unknown> = {}) {
  const sent: { op: "call" | "view"; method: string; args: unknown }[] = [];
  const client = {
    call: vi.fn(async (_app: string, method: string, args?: unknown) => {
      sent.push({ op: "call", method, args });
      return { index: 7, result: answers[method] ?? null, events: [] };
    }),
    view: vi.fn(async (_app: string, method: string, args?: unknown) => {
      sent.push({ op: "view", method, args });
      return { index: 42, result: answers[method] ?? null };
    }),
  };
  return { client, sent };
}

describe("blocks(): the wire", () => {
  it("sends writes as calls with `now` as a decimal string and the device label", async () => {
    const { client, sent } = fakeClient({ setBlocks: 1 });
    const after = vi.fn();
    const api = blocks(client, "app-1", "dev1", after);
    expect(await api.setBlocks([{ x: 1, y: 2, z: 3, b: 4 }], 1700000000.9)).toBe(1);
    await api.join("Alice", 1700000001);
    await api.heartbeat({ name: "Alice", x: 1, y: 2, z: 3, yaw: 0, pitch: 0, sel: 2 }, 1700000002);
    await api.leave(1700000003);
    expect(sent).toEqual([
      { op: "call", method: "setBlocks", args: { edits: [{ x: 1, y: 2, z: 3, b: 4 }], now: "1700000000", device: "dev1" } },
      { op: "call", method: "join", args: { name: "Alice", now: "1700000001", device: "dev1" } },
      {
        op: "call",
        method: "heartbeat",
        args: { t: { name: "Alice", x: 1, y: 2, z: 3, yaw: 0, pitch: 0, sel: 2 }, now: "1700000002", device: "dev1" },
      },
      { op: "call", method: "leave", args: { now: "1700000003", device: "dev1" } },
    ]);
    expect(client.call).toHaveBeenCalledWith("app-1", "join", expect.anything());
    expect(after).toHaveBeenCalledTimes(4);
  });

  it("reads the meta's u64s as numbers, with the index it was read at", async () => {
    const { client, sent } = fakeClient({ worldMeta: { name: "w", seed: "4294967295", createdAt: "1700000000" } });
    const read = await blocks(client, "a", "d").worldMeta();
    expect(read).toEqual({ meta: { name: "w", seed: 4294967295, createdAt: 1700000000 }, index: 42 });
    expect(sent[0]).toEqual({ op: "view", method: "worldMeta", args: {} });
  });

  it("maps the roster to what the game draws and reads the counts", async () => {
    const row = { id: "acc/d", account: "acc", device: "d", name: "A", x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0, sel: 1, online: true };
    const { client, sent } = fakeClient({
      getPlayers: { items: [row], next: null },
      worldStats: { overrides: "3", players: "1" },
      overrideCount: 3,
      myAccount: "acc",
      getOverrides: { items: [{ k: "1,2,3", b: 4 }], next: null },
    });
    const api = blocks(client, "a", "d");
    expect(await api.getPlayers(99)).toEqual([
      { id: "acc/d", name: "A", x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0, sel: 1, online: true },
    ]);
    expect(sent[0].args).toEqual({ now: "99" });
    expect(await api.worldStats()).toEqual({ overrides: 3, players: 1 });
    expect(await api.overrideCount()).toBe(3);
    expect(await api.myAccount()).toBe("acc");
    expect(await api.getOverrides()).toEqual([{ k: "1,2,3", b: 4 }]);
  });

  it("runs `after` even when a request fails", async () => {
    const after = vi.fn();
    const client = {
      call: vi.fn(async () => {
        throw new Error("down");
      }),
      view: vi.fn(),
    };
    await expect(blocks(client as never, "a", "d", after).leave(1)).rejects.toThrow("down");
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("paged views", () => {
  it("follow `next` until it is null, keeping the other arguments", async () => {
    const pages: Record<string, { items: unknown[]; next: string | null }> = {
      "": { items: [{ k: "1,1,1", b: 1 }, { k: "1,1,2", b: 2 }], next: "c1" },
      c1: { items: [{ k: "1,1,3", b: 3 }], next: "c2" },
      c2: { items: [], next: null },
    };
    const sent: unknown[] = [];
    const client = {
      call: vi.fn(),
      view: vi.fn(async (_app: string, method: string, args?: unknown) => {
        sent.push({ method, args });
        const cursor = (args as { cursor?: string }).cursor ?? "";
        return { index: 1, result: pages[cursor] };
      }),
    };
    const entries = await blocks(client as never, "a", "d").getOverrides();
    expect(entries.map((e) => e.b)).toEqual([1, 2, 3]);
    expect(sent).toEqual([
      { method: "getOverrides", args: {} },
      { method: "getOverrides", args: { cursor: "c1" } },
      { method: "getOverrides", args: { cursor: "c2" } },
    ]);
  });

  it("send `now` on every page of the roster", async () => {
    const seen: unknown[] = [];
    const row = { id: "a", account: "a", device: "", name: "A", x: 0, y: 0, z: 0, yaw: 0, pitch: 0, sel: 0, online: true };
    const client = {
      call: vi.fn(),
      view: vi.fn(async (_app: string, _m: string, args?: unknown) => {
        seen.push(args);
        return { index: 1, result: (args as { cursor?: string }).cursor ? { items: [row], next: null } : { items: [row], next: "p2" } };
      }),
    };
    expect(await blocks(client as never, "a", "d").getPlayers(5)).toHaveLength(2);
    expect(seen).toEqual([{ now: "5" }, { now: "5", cursor: "p2" }]);
  });
});

describe("init arguments and ids", () => {
  it("puts the seed in [0, 2^32) and both u64s as decimal strings", () => {
    expect(initArgs("w", 4294967296 + 5, 1700000000.4)).toEqual({ name: "w", seed: "5", now: "1700000000" });
  });

  it("builds the avatar id the contract answers", () => {
    expect(playerId("acc", "")).toBe("acc");
    expect(playerId("acc", "laptop")).toBe("acc/laptop");
  });
});
