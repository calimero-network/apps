import { describe, it, expect, vi } from "vitest";
import { mapLimit } from "./concurrency";

/** Resolves after a tick, recording how many calls were in flight at its peak. */
function tracker() {
  let inFlight = 0;
  let peak = 0;
  return {
    get peak() { return peak; },
    run: async <T>(value: T): Promise<T> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return value;
    },
  };
}

describe("mapLimit", () => {
  it("keeps the results in input order", async () => {
    // Deliberately finish in reverse, so ordering cannot come from completion time.
    const out = await mapLimit([30, 20, 10], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 20, 10]);
  });

  it("never exceeds the limit", async () => {
    const t = tracker();
    await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, t.run);
    expect(t.peak).toBeLessThanOrEqual(3);
  });

  it("actually runs concurrently — this is the point of it", async () => {
    const t = tracker();
    await mapLimit([1, 2, 3, 4], 4, t.run);
    expect(t.peak).toBeGreaterThan(1);
  });

  it("passes the index through", async () => {
    const out = await mapLimit(["a", "b", "c"], 2, async (item, i) => `${i}:${item}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("handles an empty list without calling anything", async () => {
    const fn = vi.fn();
    expect(await mapLimit([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("clamps a nonsense limit rather than spinning or stalling", async () => {
    for (const limit of [0, -5, Number.NaN]) {
      expect(await mapLimit([1, 2, 3], limit, async (n) => n * 2)).toEqual([2, 4, 6]);
    }
  });

  it("does not spawn more workers than there are items", async () => {
    const t = tracker();
    await mapLimit([1, 2], 16, t.run);
    expect(t.peak).toBeLessThanOrEqual(2);
  });

  it("rejects on a failure, so a half-written document surfaces as an error", async () => {
    await expect(mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("upload failed");
      return n;
    })).rejects.toThrow("upload failed");
  });

  it("stops starting new work once something has failed", async () => {
    const started: number[] = [];
    await expect(mapLimit([1, 2, 3, 4, 5, 6], 1, async (n) => {
      started.push(n);
      if (n === 2) throw new Error("boom");
      return n;
    })).rejects.toThrow("boom");
    // Serial and failing on the second item: nothing after it should have begun.
    expect(started).toEqual([1, 2]);
  });
});
