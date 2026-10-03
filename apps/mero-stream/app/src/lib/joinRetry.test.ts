import { describe, expect, it } from "vitest";
import { JOIN_RETRY_DELAYS_MS, retryUntilValue } from "./joinRetry";

/** A fake clock: `sleep` advances `now` instead of waiting. */
function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

describe("retryUntilValue", () => {
  it("returns the first value without sleeping", async () => {
    const clock = fakeClock();
    let calls = 0;
    const out = await retryUntilValue(
      async () => {
        calls++;
        return "member";
      },
      { deadlineMs: 60_000, isCancelled: () => false, ...clock },
    );
    expect(out).toBe("member");
    expect(calls).toBe(1);
    expect(clock.slept).toEqual([]);
  });

  // The journey failure: the room's context had not finished its first sync on
  // the joining node, so `join` came back null (core's Uninitialized, swallowed
  // by useExecute). Synced ~340ms later — a single attempt never saw it.
  it("keeps trying while the context is still warming up", async () => {
    const clock = fakeClock();
    let calls = 0;
    const out = await retryUntilValue(
      async () => (++calls < 4 ? null : "member"),
      { deadlineMs: 60_000, isCancelled: () => false, ...clock },
    );
    expect(out).toBe("member");
    expect(calls).toBe(4);
    expect(clock.slept).toEqual(JOIN_RETRY_DELAYS_MS.slice(0, 3));
  });

  it("holds the last delay once the schedule runs out", async () => {
    const clock = fakeClock();
    let calls = 0;
    const n = JOIN_RETRY_DELAYS_MS.length + 3;
    await retryUntilValue(async () => (++calls < n ? null : 1), {
      deadlineMs: 600_000,
      isCancelled: () => false,
      ...clock,
    });
    const last = JOIN_RETRY_DELAYS_MS[JOIN_RETRY_DELAYS_MS.length - 1];
    expect(clock.slept.slice(-3)).toEqual([last, last, last]);
  });

  it("gives up with null at the deadline", async () => {
    const clock = fakeClock();
    let calls = 0;
    const out = await retryUntilValue(
      async () => {
        calls++;
        return null;
      },
      { deadlineMs: 10_000, isCancelled: () => false, ...clock },
    );
    expect(out).toBeNull();
    expect(calls).toBeGreaterThan(1);
    expect(clock.now()).toBeLessThanOrEqual(10_000);
  });

  it("stops as soon as it is cancelled", async () => {
    const clock = fakeClock();
    let calls = 0;
    let cancelled = false;
    const out = await retryUntilValue(
      async () => {
        calls++;
        cancelled = true;
        return null;
      },
      { deadlineMs: 60_000, isCancelled: () => cancelled, ...clock },
    );
    expect(out).toBeNull();
    expect(calls).toBe(1);
  });

  it("does not report a value that lands after cancellation", async () => {
    const clock = fakeClock();
    let cancelled = false;
    const out = await retryUntilValue(
      async () => {
        cancelled = true;
        return "late";
      },
      { deadlineMs: 60_000, isCancelled: () => cancelled, ...clock },
    );
    expect(out).toBeNull();
  });
});
