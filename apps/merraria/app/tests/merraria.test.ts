import { describe, expect, it, vi } from "vitest";

import abiJson from "../../logic/res/abi.json";
import { CALLS, VIEWS, bindExec, merraria, readAllOverrides, toSeed } from "../src/net/merraria";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = abiJson as unknown as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    const m = merraria(bindExec(withRoutes({ call: vi.fn(record), view: vi.fn(record) }), "world-1"));
    await Promise.all([
      m.createWorld("w", 1),
      m.worldMeta(),
      m.setTiles([{ x: 1, y: 1, t: 1 }]),
      m.getOverrides("cursor-1", 10),
      m.join("A"),
      m.heartbeat({ name: "A", x: 1, y: 1, dir: 1, sel: 0, action: "idle" }),
      m.leave(),
      m.getPlayers(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it("sends every `now` as whole seconds (a u32), never a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: null, events: [] });
    const m = merraria(bindExec(withRoutes({ call, view: vi.fn() }), "w"));
    await m.leave();
    const now = (call.mock.calls[0][2] as { now: unknown }).now;
    expect(typeof now).toBe("number");
    expect(Number.isInteger(now)).toBe(true);
    expect(now as number).toBeLessThan(2 ** 32);
  });
});

describe("bindExec", () => {
  it("routes calls through the log and views to a node, unwrapping the result and reporting the index", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: 2, events: [] });
    const view = vi.fn().mockResolvedValue({ index: 4, result: [] });
    const after = vi.fn();
    const onIndex = vi.fn();
    const exec = bindExec(withRoutes({ call, view }), "w", after, onIndex);

    expect(await exec("setTiles", { edits: [], now: 1 })).toBe(2);
    expect(call).toHaveBeenCalledWith("w", "setTiles", { edits: [], now: 1 });
    expect(await exec("getOverrides", {})).toEqual([]);
    expect(view).toHaveBeenCalledWith("w", "getOverrides", {});
    expect(onIndex.mock.calls).toEqual([[3], [4]]);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const exec = bindExec(withRoutes({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error("boom")) }), "w", after);
    await expect(exec("worldMeta", {})).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("toSeed", () => {
  it("keeps a seed the contract takes (a u32), else the fallback", () => {
    expect(toSeed("42", 1337)).toBe(42);
    expect(toSeed("-42", 1337)).toBe(42);
    expect(toSeed("abc", 1337)).toBe(1337);
    expect(toSeed("0", 1337)).toBe(1337);
    expect(toSeed(2 ** 32 + 5, 1)).toBe(5);
  });
});

describe("readAllOverrides", () => {
  it("reads page after page until `next` is null, sending each cursor back", async () => {
    const pages: Record<string, { items: { k: string; t: number }[]; next: string | null }> = {
      first: { items: [{ k: "0,0", t: 1 }, { k: "1,0", t: 2 }], next: "c1" },
      c1: { items: [{ k: "2,0", t: 3 }], next: "c2" },
      c2: { items: [], next: null },
    };
    const sent: unknown[] = [];
    const exec = vi.fn(async (_method: string, args: Record<string, unknown>) => {
      sent.push(args);
      return pages[(args.cursor as string | undefined) ?? "first"];
    });
    expect(await readAllOverrides(exec as never)).toEqual([
      { k: "0,0", t: 1 },
      { k: "1,0", t: 2 },
      { k: "2,0", t: 3 },
    ]);
    expect(sent).toEqual([{}, { cursor: "c1" }, { cursor: "c2" }]);
  });
});
