import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpcCall } = vi.hoisted(() => ({ rpcCall: vi.fn() }));
vi.mock("./rpc", () => ({ rpcCall }));

import {
  resetBatchSupport,
  addElements,
  deleteChunkSize,
  deleteElements,
  getElementsByIds,
  updateElementLabels,
  updateElements,
  WRITE_CHUNK,
} from "./elementBatch";
import type { Element } from "../types";

const el = (id: string) => ({ id }) as unknown as Element;
const els = (n: number) => Array.from({ length: n }, (_, i) => el(`e${i}`));
const calls = (method: string) => rpcCall.mock.calls.filter((c) => c[1] === method);

beforeEach(() => {
  rpcCall.mockReset();
  rpcCall.mockResolvedValue(null);
  resetBatchSupport();
});

// A board keeps the bundle its context was created with, so a new frontend
// meets contracts that have no batch methods. merod 0.11.0-rc.43's answer:
const MISSING = (m: string) => new Error(`method "${m}" not found`);

describe("a board on an older contract", () => {
  it("falls back to single calls, one at a time, and remembers the board", async () => {
    let inFlight = 0;
    let peak = 0;
    rpcCall.mockImplementation(async (_ctx: string, method: string) => {
      if (method === "add_elements") throw MISSING(method);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });
    await addElements("old", els(150), vi.fn());
    // Tried once, then never again for this board.
    expect(calls("add_elements")).toHaveLength(1);
    expect(calls("add_element")).toHaveLength(150);
    expect(peak).toBe(1);

    rpcCall.mockClear();
    await addElements("old", els(3), vi.fn());
    expect(calls("add_elements")).toHaveLength(0);
    expect(calls("add_element")).toHaveLength(3);
  });

  it("keeps trying batches on a board that has them", async () => {
    rpcCall.mockImplementation(async (ctx: string, method: string) => {
      if (ctx === "old" && method === "delete_elements") throw MISSING(method);
      return null;
    });
    await deleteElements("old", ["a", "b"], 2, vi.fn());
    await deleteElements("new", ["a", "b"], 2, vi.fn());
    expect(calls("delete_element").map((c) => c[0])).toEqual(["old", "old"]);
    expect(calls("delete_elements").map((c) => c[0])).toEqual(["old", "new"]);
  });

  it("sends every item of a fallen-back chunk even past a failure, and reports it", async () => {
    rpcCall.mockImplementation(async (_ctx: string, method: string, args: { id?: string }) => {
      if (method === "update_element_labels") throw MISSING(method);
      if (args.id === "b") throw new Error("view-only");
      return null;
    });
    const onError = vi.fn();
    await updateElementLabels("old", { a: "x", b: "y", c: "z" }, 1, onError);
    expect(calls("update_element_label").map((c) => c[2].id)).toEqual(["a", "b", "c"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("fills a patch out to update_element's full argument list", async () => {
    rpcCall.mockImplementation(async (_ctx: string, method: string) => {
      if (method === "update_elements") throw MISSING(method);
      return null;
    });
    await updateElements("old", [{ id: "a", x: 5 }], 9, vi.fn());
    expect(calls("update_element")[0][2]).toEqual({
      id: "a", x: 5, y: null, width: null, height: null, rotation: null,
      fill: null, stroke: null, stroke_width: null, opacity: null, corner_radius: null, updated_at: 9,
    });
  });

  it("reads an old board's batch with one full read", async () => {
    rpcCall.mockImplementation(async (_ctx: string, method: string) => {
      if (method === "get_elements_by_ids") throw MISSING(method);
      if (method === "get_elements") return els(300);
      return null;
    });
    const got = await getElementsByIds("old", ["e1", "e299", "gone"]);
    expect(got.map((e) => e.id)).toEqual(["e1", "e299"]);
    expect(calls("get_elements")).toHaveLength(1);
  });

  it("does not fall back on an ordinary refusal", async () => {
    rpcCall.mockRejectedValue(new Error("view-only: editor or admin access is required"));
    const onError = vi.fn();
    await addElements("ctx", els(2), onError);
    expect(calls("add_element")).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("addElements", () => {
  it("sends a 3000-element paste as 30 calls, never 3000", async () => {
    await addElements("ctx", els(3000), vi.fn());
    const sent = calls("add_elements");
    expect(sent).toHaveLength(3000 / WRITE_CHUNK);
    expect(sent.every((c) => c[2].elements.length === WRITE_CHUNK)).toBe(true);
    expect(sent.flatMap((c) => c[2].elements.map((e: Element) => e.id))).toEqual(els(3000).map((e) => e.id));
  });

  it("keeps one call in flight at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    rpcCall.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });
    await addElements("ctx", els(450), vi.fn());
    expect(peak).toBe(1);
  });

  it("reports a failed chunk and still sends the rest", async () => {
    rpcCall.mockRejectedValueOnce(new Error("network error"));
    const onError = vi.fn();
    await addElements("ctx", els(250), onError);
    expect(calls("add_elements")).toHaveLength(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("add_elements", expect.any(Error));
  });

  it("sends nothing for nothing", async () => {
    await addElements("ctx", [], vi.fn());
    expect(rpcCall).not.toHaveBeenCalled();
  });
});

describe("updateElements / updateElementLabels", () => {
  it("chunks patches and stamps every chunk with the one edit's time", async () => {
    const patches = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, x: i }));
    await updateElements("ctx", patches, 42, vi.fn());
    const sent = calls("update_elements");
    expect(sent.map((c) => c[2].patches.length)).toEqual([100, 50]);
    expect(sent.every((c) => c[2].updated_at === 42)).toBe(true);
  });

  it("turns a label patch into id/label pairs, null clearing a label", async () => {
    await updateElementLabels("ctx", { a: "Group 1/a", b: null }, 7, vi.fn());
    expect(calls("update_element_labels")).toEqual([
      ["ctx", "update_element_labels", { labels: [{ id: "a", label: "Group 1/a" }, { id: "b", label: null }], updated_at: 7 }],
    ]);
  });
});

describe("deleteChunkSize", () => {
  // Measured on merod 0.11.0-rc.43: the most one call can delete is about
  // 22 000 / board size. The chunk must stay under that everywhere.
  it.each([
    [10, 50],
    [300, 50],
    [1000, 15],
    [2000, 7],
    [4000, 3],
    [20000, 1],
    [0, 50],
  ])("board of %i → %i per call", (board, expected) => {
    expect(deleteChunkSize(board)).toBe(expected);
  });

  it("never exceeds the measured limit", () => {
    for (const [board, limit] of [[1000, 23], [2000, 11], [4000, 6]] as const) {
      expect(deleteChunkSize(board)).toBeLessThan(limit);
    }
  });
});

describe("deleteElements", () => {
  it("sizes chunks from the board and grows them as it shrinks", async () => {
    const ids = els(1000).map((e) => e.id);
    await deleteElements("ctx", ids, 1000, vi.fn());
    const sizes = calls("delete_elements").map((c) => c[2].ids.length);
    expect(sizes[0]).toBe(15);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0]);
    expect(sizes.every((n, i) => n <= deleteChunkSize(1000 - sizes.slice(0, i).reduce((a, b) => a + b, 0)))).toBe(true);
    expect(calls("delete_elements").flatMap((c) => c[2].ids)).toEqual(ids);
  });

  it("halves a chunk that runs out of gas and retries it", async () => {
    rpcCall.mockRejectedValueOnce(new Error("execution exhausted its gas limit of 1000000000 points"));
    const ids = els(40).map((e) => e.id);
    const onError = vi.fn();
    await deleteElements("ctx", ids, 40, onError);
    const sent = calls("delete_elements").map((c) => c[2].ids);
    expect(sent[0]).toHaveLength(40);
    expect(sent[1]).toHaveLength(20);
    // Nothing lost: every id after the failed attempt went out exactly once.
    expect(sent.slice(1).flat()).toEqual(ids);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a non-gas failure and moves on", async () => {
    rpcCall.mockRejectedValueOnce(new Error("view-only"));
    const onError = vi.fn();
    await deleteElements("ctx", els(60).map((e) => e.id), 60, onError);
    expect(onError).toHaveBeenCalledWith("delete_elements", expect.any(Error));
    expect(calls("delete_elements").flatMap((c) => c[2].ids)).toHaveLength(60);
  });

  it("gives up halving at one id and reports it", async () => {
    rpcCall.mockRejectedValue(new Error("execution exhausted its gas limit"));
    const onError = vi.fn();
    await deleteElements("ctx", ["a", "b"], 2, onError);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe("getElementsByIds", () => {
  it("reads in chunks and treats an empty answer as nothing", async () => {
    rpcCall.mockResolvedValueOnce(els(100)).mockResolvedValueOnce(null);
    const got = await getElementsByIds("ctx", els(150).map((e) => e.id));
    expect(calls("get_elements_by_ids")).toHaveLength(2);
    expect(got).toHaveLength(100);
  });
});
