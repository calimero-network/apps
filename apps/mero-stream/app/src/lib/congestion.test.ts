import { describe, expect, it } from "vitest";
import {
  BACKOFF_FACTOR,
  COOLDOWN_MS,
  CONGESTED_MS,
  FAILURE_STREAK_TRIP,
  HEALTHY_MS,
  MIN_BITRATE,
  initialCongestion,
  nextBitrate,
  recordPost,
} from "./congestion";

const START = 1_500_000;

/** Feed `n` identical samples. */
function samples(
  state: ReturnType<typeof initialCongestion>,
  n: number,
  durationMs: number,
  ok = true,
) {
  let s = state;
  for (let i = 0; i < n; i++) s = recordPost(s, { durationMs, ok });
  return s;
}

describe("congestion control", () => {
  it("does nothing before it has a sample", () => {
    const s = initialCongestion(START);
    expect(nextBitrate(s, START, COOLDOWN_MS * 10).current).toBe(START);
  });

  it("holds the requested rate while posts are fast", () => {
    let s = samples(initialCongestion(START), 20, 40);
    s = nextBitrate(s, START, COOLDOWN_MS * 10);
    expect(s.current).toBe(START);
  });

  it("backs off when posts are slow", () => {
    // The retro's shape: post_chunk queueing far past the 40 ms frame period.
    let s = samples(initialCongestion(START), 30, CONGESTED_MS * 2);
    s = nextBitrate(s, START, COOLDOWN_MS * 10);
    expect(s.current).toBe(Math.round(START * BACKOFF_FACTOR));
  });

  it("respects the cooldown between steps", () => {
    let s = samples(initialCongestion(START), 30, CONGESTED_MS * 2);
    const t = COOLDOWN_MS * 10;
    s = nextBitrate(s, START, t);
    const afterFirst = s.current;
    // Immediately after: no second step.
    s = nextBitrate(s, START, t + 1);
    expect(s.current).toBe(afterFirst);
    // Once the cooldown elapses it may step again.
    s = nextBitrate(s, START, t + COOLDOWN_MS + 1);
    expect(s.current).toBeLessThan(afterFirst);
  });

  it("never falls below the floor", () => {
    let s = initialCongestion(START);
    let t = 0;
    for (let i = 0; i < 40; i++) {
      s = samples(s, 10, CONGESTED_MS * 4);
      t += COOLDOWN_MS + 1;
      s = nextBitrate(s, START, t);
    }
    expect(s.current).toBe(MIN_BITRATE);
  });

  it("trips immediately on a failure streak, ignoring the cooldown", () => {
    // Posts failing outright is the strongest signal available — the retro's
    // node was rejecting them while the relay refused circuits.
    let s = samples(initialCongestion(START), 5, 40);
    s = nextBitrate(s, START, 1_000);
    expect(s.current).toBe(START);
    s = samples(s, FAILURE_STREAK_TRIP, 40, false);
    // Well inside the cooldown, but the streak overrides it.
    s = nextBitrate(s, START, 1_001);
    expect(s.current).toBeLessThan(START);
  });

  it("clears the streak after stepping so one bad patch is one step", () => {
    let s = samples(initialCongestion(START), 5, 40);
    s = samples(s, FAILURE_STREAK_TRIP, 40, false);
    s = nextBitrate(s, START, 1_000);
    expect(s.failureStreak).toBe(0);
    const after = s.current;
    // No new failures: the next call inside the cooldown changes nothing.
    s = nextBitrate(s, START, 1_001);
    expect(s.current).toBe(after);
  });

  it("recovers toward the requested rate once posts are fast again", () => {
    let s = samples(initialCongestion(START), 30, CONGESTED_MS * 2);
    let t = COOLDOWN_MS * 10;
    s = nextBitrate(s, START, t);
    const dipped = s.current;
    expect(dipped).toBeLessThan(START);

    s = samples(s, 40, HEALTHY_MS / 3);
    t += COOLDOWN_MS + 1;
    s = nextBitrate(s, START, t);
    expect(s.current).toBeGreaterThan(dipped);
  });

  it("recovers no further than the requested ceiling", () => {
    let s = samples(initialCongestion(START), 30, CONGESTED_MS * 2);
    let t = COOLDOWN_MS * 10;
    s = nextBitrate(s, START, t);
    for (let i = 0; i < 30; i++) {
      s = samples(s, 10, 10);
      t += COOLDOWN_MS + 1;
      s = nextBitrate(s, START, t);
    }
    expect(s.current).toBe(START);
  });

  it("applies a lowered ceiling immediately, without waiting out the cooldown", () => {
    // The slider is an instruction, not a hint.
    let s = samples(initialCongestion(START), 10, 40);
    s = nextBitrate(s, START, 1_000);
    expect(s.current).toBe(START);
    s = nextBitrate(s, 400_000, 1_001);
    expect(s.current).toBe(400_000);
  });

  it("keeps the mean bounded between two samples", () => {
    // Sanity on the EWMA itself: it must sit between the extremes it saw.
    const s = recordPost(
      recordPost(initialCongestion(START), { durationMs: 100, ok: true }),
      {
        durationMs: 900,
        ok: true,
      },
    );
    expect(s.meanPostMs).toBeGreaterThan(100);
    expect(s.meanPostMs).toBeLessThan(900);
  });
});
