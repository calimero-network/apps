import { describe, expect, it, vi } from "vitest";

import { MerrariaClient } from "../src/generated/client";
import { indexed, nowSecs, readAllOverrides, toSeed } from "../src/net/merraria";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("the world's clock and log index", () => {
  it("sends every `now` as whole seconds (a u32), never a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: null, events: [] });
    const m = new MerrariaClient(withRoutes({ call, view: vi.fn() }), "w");
    await m.leave({ now: nowSecs() });
    const now = (call.mock.calls[0][2] as { now: unknown }).now;
    expect(typeof now).toBe("number");
    expect(Number.isInteger(now)).toBe(true);
    expect(now as number).toBeLessThan(2 ** 32);
  });

  it("reports the log index of every answer, and runs `after` on failures too", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: 2, events: [] });
    const view = vi.fn().mockResolvedValueOnce({ index: 4, result: [] }).mockRejectedValue(new Error("boom"));
    const after = vi.fn();
    const onIndex = vi.fn();
    const m = new MerrariaClient(indexed(withRoutes({ call, view }), onIndex), "w", { after });

    expect(await m.setTiles({ edits: [], now: 1 })).toBe(2);
    expect(call).toHaveBeenCalledWith("w", "setTiles", { edits: [], now: 1 });
    expect(await m.getOverrides({})).toEqual([]);
    expect(view).toHaveBeenCalledWith("w", "getOverrides", {});
    expect(onIndex.mock.calls).toEqual([[3], [4]]);
    await expect(m.worldMeta()).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(3);
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
    const getOverrides = vi.fn(async (args: { cursor?: string | null }) => {
      sent.push(args);
      return pages[args.cursor ?? "first"];
    });
    expect(await readAllOverrides({ getOverrides })).toEqual([
      { k: "0,0", t: 1 },
      { k: "1,0", t: 2 },
      { k: "2,0", t: 3 },
    ]);
    expect(sent).toEqual([{}, { cursor: "c1" }, { cursor: "c2" }]);
  });
});
