import { describe, expect, it } from "vitest";
import {
  ProbeRecorder,
  countSeqGaps,
  percentile,
  ratePerSecond,
  type FrameSample,
} from "./metrics";

// These are the §4 numbers that ARE the Task-3 deliverable, so the arithmetic
// gets the same scrutiny as the codec. A quietly-wrong percentile or rate
// produces a plausible failure curve that says the wrong thing, which is worse
// than no curve at all.

/** A frame sample with sensible defaults; override only what a test cares about. */
function frame(over: Partial<FrameSample> = {}): FrameSample {
  return {
    seq: 1,
    createdAt: 1_000,
    renderedAt: 1_500,
    encodedBytes: 512,
    rawBytes: 3072, // 64x48 luma
    ...over,
  };
}

describe("percentile", () => {
  it("returns null for no samples rather than NaN", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("returns an observation that actually happened (nearest-rank, no interpolation)", () => {
    const values = [10, 20, 30, 40];
    // Interpolated p50 would invent 25, which was never measured.
    expect(percentile(values, 0.5)).toBe(20);
    expect(values).toEqual([10, 20, 30, 40]); // input not mutated by the sort
  });

  it("puts p95 and p100 at the top of the distribution", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 1)).toBe(100);
  });

  it("clamps a zero/negative quantile to the lowest observation", () => {
    expect(percentile([5, 9, 1], 0)).toBe(1);
  });

  it("is order-independent", () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
  });
});

describe("countSeqGaps", () => {
  it("finds nothing in a contiguous run", () => {
    expect(countSeqGaps([1, 2, 3, 4, 5])).toBe(0);
  });

  it("counts every frame missing from a forward jump", () => {
    expect(countSeqGaps([1, 2, 7])).toBe(4); // 3,4,5,6
  });

  it("ignores duplicates and out-of-order arrivals (reordering is not loss)", () => {
    // Under stress the pipeline reorders; counting that as drop would inflate
    // the figure exactly when it must be trustworthy.
    expect(countSeqGaps([1, 2, 2, 3])).toBe(0);
    expect(countSeqGaps([3, 1, 2])).toBe(0); // 1,2,3 all arrived, just not in order
  });

  it("takes a gap back when the straggler lands (the reordering regression)", () => {
    // Seq 5 rendered before 2,3,4 — a forward-jump counter books 3 permanent
    // losses here and reports drops for a run that dropped nothing.
    expect(countSeqGaps([1, 5])).toBe(3);
    expect(countSeqGaps([1, 5, 2, 3, 4])).toBe(0);
  });

  it("does not treat a non-1 starting seq as a gap", () => {
    expect(countSeqGaps([500, 501])).toBe(0);
  });

  it("handles empty and single-sample input", () => {
    expect(countSeqGaps([])).toBe(0);
    expect(countSeqGaps([42])).toBe(0);
  });
});

describe("ratePerSecond", () => {
  it("computes over the observed span", () => {
    expect(ratePerSecond(10, 2000)).toBe(5);
  });

  it("refuses to divide by a zero span instead of returning Infinity", () => {
    expect(ratePerSecond(1, 0)).toBe(0);
    expect(ratePerSecond(5, -10)).toBe(0);
  });

  it("is zero when nothing was counted", () => {
    expect(ratePerSecond(0, 5000)).toBe(0);
  });
});

describe("ProbeRecorder", () => {
  it("reports empty aggregates as null, not zero, before any sample", () => {
    const snap = new ProbeRecorder().snapshot();
    expect(snap.latencyMsP50).toBeNull();
    expect(snap.encodeMsP95).toBeNull();
    expect(snap.compressionRatio).toBeNull();
    expect(snap.renderFps).toBe(0);
    expect(snap.frameSamples).toBe(0);
  });

  it("derives latency from the two timestamps", () => {
    const r = new ProbeRecorder();
    r.recordFrame(frame({ seq: 1, createdAt: 1_000, renderedAt: 1_800 }));
    r.recordFrame(frame({ seq: 2, createdAt: 2_000, renderedAt: 2_400 }));
    const snap = r.snapshot();
    expect(snap.latencyMsP50).toBe(400);
    expect(snap.latencyMsMax).toBe(800);
  });

  it("computes ingest rate and compression over the window span", () => {
    const r = new ProbeRecorder();
    // Three frames spanning exactly 2s → 1.5 frames/s.
    r.recordFrame(frame({ seq: 1, renderedAt: 1_000, encodedBytes: 300, rawBytes: 3000 }));
    r.recordFrame(frame({ seq: 2, renderedAt: 2_000, encodedBytes: 300, rawBytes: 3000 }));
    r.recordFrame(frame({ seq: 3, renderedAt: 3_000, encodedBytes: 300, rawBytes: 3000 }));
    const snap = r.snapshot();
    expect(snap.renderFps).toBeCloseTo(1.5, 5);
    expect(snap.encodedBytesPerSec).toBeCloseTo(450, 5); // 900 bytes / 2s
    expect(snap.compressionRatio).toBeCloseTo(10, 5);
  });

  it("counts encode failures and excludes them from the send-rate and percentiles", () => {
    const r = new ProbeRecorder();
    r.recordEncode({ startedAt: 1_000, durationMs: 40, ok: true });
    r.recordEncode({ startedAt: 2_000, durationMs: 9_999, ok: false });
    r.recordEncode({ startedAt: 3_000, durationMs: 60, ok: true });
    const snap = r.snapshot();
    expect(snap.encodeErrors).toBe(1);
    // A failed call's duration must not pollute the encode-cost distribution.
    expect(snap.encodeMsP95).toBe(60);
    // Rate is over the OK calls' own span (1000ms → 3000ms), 2 calls / 2s.
    expect(snap.sendFps).toBeCloseTo(1, 5);
  });

  it("bounds the rolling window but keeps the total count honest", () => {
    const r = new ProbeRecorder(3);
    for (let seq = 1; seq <= 10; seq++) {
      r.recordFrame(frame({ seq, renderedAt: 1_000 + seq * 100 }));
    }
    const snap = r.snapshot();
    expect(snap.frameSamples).toBe(3); // window trimmed
    expect(snap.framesRenderedTotal).toBe(10); // total not trimmed
  });

  it("emits one CSV row per frame with a header, unaffected by the window", () => {
    const r = new ProbeRecorder(2); // window smaller than the sample count
    r.recordFrame(frame({ seq: 1, createdAt: 1_000, renderedAt: 1_600, encodedBytes: 300, rawBytes: 3000 }));
    r.recordFrame(frame({ seq: 2, createdAt: 2_000, renderedAt: 2_500 }));
    r.recordFrame(frame({ seq: 3, createdAt: 3_000, renderedAt: 3_100 }));
    const lines = r.toCsv().split("\n");
    expect(lines[0]).toBe(
      "seq,created_at_ms,rendered_at_ms,latency_ms,encoded_bytes,raw_bytes,compression_ratio",
    );
    // The window holds 2, but the CSV — the actual P3 artifact — holds all 3.
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("1,1000,1600,600,300,3000,10.0000");
  });

  it("reports CSV truncation rather than silently dropping samples", () => {
    const r = new ProbeRecorder(10, 2);
    expect(r.csvTruncated()).toBe(false);
    r.recordFrame(frame({ seq: 1 }));
    r.recordFrame(frame({ seq: 2 }));
    r.recordFrame(frame({ seq: 3 }));
    expect(r.csvTruncated()).toBe(true);
    expect(r.toCsv().split("\n")).toHaveLength(3); // header + the 2 retained
  });

  it("surfaces seq gaps observed across the window", () => {
    const r = new ProbeRecorder();
    r.recordFrame(frame({ seq: 1 }));
    r.recordFrame(frame({ seq: 5 }));
    expect(r.snapshot().seqGaps).toBe(3);
  });

  it("clears every counter on reset", () => {
    const r = new ProbeRecorder();
    r.recordFrame(frame());
    r.recordEncode({ startedAt: 1, durationMs: 2, ok: false });
    r.reset();
    const snap = r.snapshot();
    expect(snap.framesRenderedTotal).toBe(0);
    expect(snap.encodeErrors).toBe(0);
    expect(snap.latencyMsP50).toBeNull();
    expect(r.toCsv().split("\n")).toHaveLength(1); // header only
  });
});
