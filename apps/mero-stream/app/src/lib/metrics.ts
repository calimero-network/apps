// ── §4 measurement layer (the Task-3 deliverable) ─────────────────────────────
//
// Task 3 is a capacity probe: "the numbers ARE the deliverable." Everything
// needed to compute them was already flowing through the app — `createdAt` rides
// on every DecodedFrame, `encodedBytes` too — but nothing added it up. This
// module is that arithmetic, kept pure and framework-free so it is unit-testable
// without a browser (same discipline as luma.ts).
//
// What we can measure honestly from the frontend, and what we cannot:
//
//   ✅ end-to-end fragment latency   capture (sender clock) → peer render
//   ✅ ingest rate                   accepted frames/s and compressed KiB/s
//   ✅ encode round-trip             wall time around the encode_frame mutation
//   ✅ seq gaps                      frames the receiver never saw (drop proxy)
//   ✅ encode failures               the backpressure/rejection signal
//   ❌ per-mutation server-side cost node-side, but AVAILABLE today: scrape
//                                    core's /metrics and divide
//                                    execution_duration_seconds_sum by _count for
//                                    the mean per method. (The histogram buckets
//                                    are 1s..512s, so only the mean is usable —
//                                    not percentiles.)
//   ❌ sealed delta size             node-side; core logs `artifact_len` at debug
//   ❌ RocksDB growth                node-side; `du` the store
//
// Measured at 64x48: 9.93 ms mean server-side vs 19.69 ms client-observed RTT
// p50 — i.e. about half of `encodeMs` below is serialization + transport, not the
// node. Keep that ratio in mind before reading encodeMs as an encode cost.
//
// The two latency caveats, stated up front because a number without them is a
// lie:
//
//   1. `latencyMs` spans TWO clocks — the sender's `createdAt` and the
//      receiver's `Date.now()`. Any skew between hosts lands in the number.
//      Trustworthy on the solo two-node harness (one host clock); needs a
//      normalized room clock before believing it across machines, exactly as
//      mero-meet had to do.
//   2. `encodeMs` is a full RPC round-trip (serialize the raw frame → node →
//      WASM encode → storage commit → seal → respond), NOT the WASM encode
//      alone. It is an upper bound on the encode cost and a fair "can the
//      sender keep up" signal, and it is the one figure here immune to clock
//      skew because it is measured entirely on one clock.

/** One frame observed on the RECEIVE side, after it was painted. */
export interface FrameSample {
  /** Contract-allocated frame seq (monotone, never reused). */
  seq: number;
  /** Sender's capture time, unix ms (`Fragment::created_at`). */
  createdAt: number;
  /** Receiver's wall clock when the frame was painted, unix ms. */
  renderedAt: number;
  /** Summed compressed bytes of the frame's stored chunks. */
  encodedBytes: number;
  /** Raw luma bytes handed to the encoder (width * height). */
  rawBytes: number;
}

/** One `encode_frame` mutation observed on the SEND side. */
export interface EncodeSample {
  /** Receiver-independent: the sender's own clock, unix ms, at call start. */
  startedAt: number;
  /** Wall time of the whole encode_frame RPC round-trip, ms. */
  durationMs: number;
  /** False when the mutation threw (rejection / backpressure / transport). */
  ok: boolean;
}

/** Aggregated snapshot rendered in the diagnostics panel. */
export interface ProbeSnapshot {
  /** Frames whose encode_frame returned OK, per second, over the window. */
  sendFps: number;
  /** Frames painted on the receive side, per second, over the window. */
  renderFps: number;
  /** Compressed bytes/s actually observed crossing into state. */
  encodedBytesPerSec: number;
  /** Raw bytes/s we would have needed without the in-WASM codec. */
  rawBytesPerSec: number;
  /** Compression ratio (raw ÷ encoded) over the window, or null if no data. */
  compressionRatio: number | null;
  encodeMsP50: number | null;
  encodeMsP95: number | null;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  /** Worst latency in the window — the "is this remotely usable" headline. */
  latencyMsMax: number | null;
  /** Frames the receiver never observed (gaps in an otherwise monotone seq). */
  seqGaps: number;
  /** encode_frame calls that threw. */
  encodeErrors: number;
  /** Samples currently in the rolling window (receive side). */
  frameSamples: number;
  /** Total frames painted since the last reset (not windowed). */
  framesRenderedTotal: number;
}

/**
 * Nearest-rank percentile over an UNSORTED array. Returns null for empty input
 * rather than NaN, so a panel can render "—" instead of a lie.
 *
 * Nearest-rank (not interpolated) on purpose: these are latency samples where
 * the honest answer is "an observation that actually happened", and with the
 * small windows the probe runs, interpolation invents values between real
 * measurements.
 */
export function percentile(
  values: readonly number[],
  q: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Rank is 1-based: ceil(q*n) clamped into [1, n], then to a 0-based index.
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil(q * sorted.length)),
  );
  return sorted[rank - 1];
}

/**
 * Count frames missing from a seq series — the frontend's proxy for §4's
 * "gossip drop / backpressure (peer seq-gaps)".
 *
 * Counts distinct seqs against the span they cover, rather than accumulating
 * forward jumps. That distinction matters under exactly the conditions the probe
 * is built to create: a stressed pipeline reorders, so seq 5 can be rendered
 * before 2,3,4 arrive. A forward-jump counter books 3 losses at seq 5 and never
 * takes them back once the stragglers land, reporting drops during a run where
 * nothing was dropped. Duplicates and a non-1 starting seq are likewise not
 * losses, and both fall out of this formulation for free.
 *
 * Caveat when reading the metric: a gap means "this receiver never rendered that
 * seq". A frame pruned out of the live window before this receiver drained it is
 * indistinguishable from one gossip lost.
 */
export function countSeqGaps(seqs: readonly number[]): number {
  if (seqs.length === 0) return 0;
  const distinct = new Set(seqs);
  let min = Infinity;
  let max = -Infinity;
  for (const seq of distinct) {
    if (seq < min) min = seq;
    if (seq > max) max = seq;
  }
  // Everything between the lowest and highest seq we saw, minus what we saw.
  return max - min + 1 - distinct.size;
}

/**
 * Events per second over the span the samples actually cover.
 *
 * Divides by the observed first→last span, not by the nominal window width, so
 * a half-full window doesn't read as half the true rate. A single sample has no
 * span and therefore no defensible rate — returns 0 rather than Infinity.
 */
export function ratePerSecond(count: number, spanMs: number): number {
  if (spanMs <= 0 || count <= 0) return 0;
  return (count * 1000) / spanMs;
}

/**
 * Rolling recorder for one probe run.
 *
 * Two rolling windows (send + receive) cap memory on a 30–60 minute sustained
 * run while keeping the aggregates responsive. A separate unbounded CSV log is
 * what P3 actually ships: the failure CURVE needs every sample, not a window,
 * and it is capped by `maxCsvRows` so a pathological run can't exhaust the tab.
 */
export class ProbeRecorder {
  private frames: FrameSample[] = [];
  private encodes: EncodeSample[] = [];
  private csvRows: FrameSample[] = [];
  private encodeErrors = 0;
  private framesRenderedTotal = 0;

  constructor(
    /** Rolling window size for the live aggregates, in samples. */
    private readonly windowSize = 300,
    /** Hard cap on retained CSV rows (~1.5 h at 5 fps). */
    private readonly maxCsvRows = 30_000,
  ) {}

  recordEncode(sample: EncodeSample): void {
    if (!sample.ok) this.encodeErrors += 1;
    this.encodes.push(sample);
    if (this.encodes.length > this.windowSize) this.encodes.shift();
  }

  recordFrame(sample: FrameSample): void {
    this.framesRenderedTotal += 1;
    this.frames.push(sample);
    if (this.frames.length > this.windowSize) this.frames.shift();
    // The CSV keeps everything (up to the cap) — the window would smooth away
    // exactly the cliff P3 is looking for.
    if (this.csvRows.length < this.maxCsvRows) this.csvRows.push(sample);
  }

  snapshot(): ProbeSnapshot {
    const frames = this.frames;
    const okEncodes = this.encodes.filter((e) => e.ok);

    // Span the receive-side window covers, by the receiver's own clock.
    const renderSpan =
      frames.length > 1
        ? frames[frames.length - 1].renderedAt - frames[0].renderedAt
        : 0;
    // Span the send-side window covers, by the sender's own clock.
    const sendSpan =
      okEncodes.length > 1
        ? okEncodes[okEncodes.length - 1].startedAt - okEncodes[0].startedAt
        : 0;

    const encodedBytes = frames.reduce((n, f) => n + f.encodedBytes, 0);
    const rawBytes = frames.reduce((n, f) => n + f.rawBytes, 0);
    const latencies = frames.map((f) => f.renderedAt - f.createdAt);
    const encodeDurations = okEncodes.map((e) => e.durationMs);

    return {
      sendFps: ratePerSecond(okEncodes.length, sendSpan),
      renderFps: ratePerSecond(frames.length, renderSpan),
      encodedBytesPerSec: ratePerSecond(encodedBytes, renderSpan),
      rawBytesPerSec: ratePerSecond(rawBytes, renderSpan),
      compressionRatio: encodedBytes > 0 ? rawBytes / encodedBytes : null,
      encodeMsP50: percentile(encodeDurations, 0.5),
      encodeMsP95: percentile(encodeDurations, 0.95),
      latencyMsP50: percentile(latencies, 0.5),
      latencyMsP95: percentile(latencies, 0.95),
      latencyMsMax: latencies.length > 0 ? Math.max(...latencies) : null,
      seqGaps: countSeqGaps(frames.map((f) => f.seq)),
      encodeErrors: this.encodeErrors,
      frameSamples: frames.length,
      framesRenderedTotal: this.framesRenderedTotal,
    };
  }

  /** True once the CSV log stopped retaining samples (report it, never hide it). */
  csvTruncated(): boolean {
    return this.csvRows.length >= this.maxCsvRows;
  }

  /**
   * Per-frame CSV — the P3 artifact. One row per rendered frame, so the failure
   * curve can be plotted straight from it (no aggregation baked in, because a
   * pre-aggregated export cannot answer a question we didn't think of).
   */
  toCsv(): string {
    const header =
      "seq,created_at_ms,rendered_at_ms,latency_ms,encoded_bytes,raw_bytes,compression_ratio";
    const rows = this.csvRows.map((f) => {
      const latency = f.renderedAt - f.createdAt;
      const ratio =
        f.encodedBytes > 0 ? (f.rawBytes / f.encodedBytes).toFixed(4) : "";
      return [
        f.seq,
        f.createdAt,
        f.renderedAt,
        latency,
        f.encodedBytes,
        f.rawBytes,
        ratio,
      ].join(",");
    });
    return [header, ...rows].join("\n");
  }

  reset(): void {
    this.frames = [];
    this.encodes = [];
    this.csvRows = [];
    this.encodeErrors = 0;
    this.framesRenderedTotal = 0;
  }
}
