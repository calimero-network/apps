/**
 * Send-side congestion control for the live path.
 *
 * ## Why this exists
 *
 * The first cross-network call (see `retro/review.md`) pushed a fixed 1.5 Mbps
 * per sender through a libp2p circuit relay, because NAT hole-punching failed
 * and there was no other path. The relay refused circuits with
 * `Remote reported resource limit exceeded`, inbound deltas went to zero for
 * minutes, and the node ended up with 277 deltas stuck pending. The sender never
 * noticed: it kept encoding at full rate into a pipe that was not moving.
 *
 * A sender that cannot see the pipe is the problem. The browser has no view of
 * libp2p transport state — it cannot ask "am I relayed?" — so relay detection is
 * not available to us. What *is* available is how long `post_chunk` takes and
 * whether it fails, and that is a direct measurement of the thing we care about:
 * can the node absorb what we are producing. Latency-based backpressure works
 * whether the cause is a relay, a slow disk, a jammed delta queue, or a peer
 * mid-sync.
 *
 * ## The policy
 *
 * An EWMA of post duration, with hysteresis and a long cooldown. Deliberately
 * sluggish: video bitrate oscillation is far more visible than a few extra
 * seconds spent at the wrong rate, and every step reconfigures the encoder.
 *
 * Kept as a pure function so the policy is unit-testable without WebCodecs, a
 * camera, or a node.
 */

/** Floor. Below this, 480p video is not worth transmitting. */
export const MIN_BITRATE = 200_000;

/** How much of the new sample the EWMA absorbs. */
export const EWMA_ALPHA = 0.2;

/**
 * Above this mean post duration, the node is not keeping up.
 *
 * At 25 fps a chunk is produced every 40 ms. A mean post of 500 ms means posts
 * are queueing roughly 12 deep and the backlog is growing, which is the shape
 * the retro logs showed right before collapse.
 */
export const CONGESTED_MS = 500;

/** Below this, there is headroom to climb back toward the requested rate. */
export const HEALTHY_MS = 150;

/** Multiplier applied on each downward step. */
export const BACKOFF_FACTOR = 0.6;

/** Multiplier applied on each upward step — recover slower than we back off. */
export const RECOVER_FACTOR = 1.25;

/** Minimum gap between adjustments. Each one reconfigures the encoder. */
export const COOLDOWN_MS = 5_000;

/** Consecutive failed posts that force a step down regardless of timing. */
export const FAILURE_STREAK_TRIP = 3;

export interface CongestionState {
  /** EWMA of `post_chunk` duration in ms; null until the first sample. */
  meanPostMs: number | null;
  /** Consecutive failed posts. */
  failureStreak: number;
  /** `Date.now()` of the last bitrate change. */
  lastAdjustedAt: number;
  /** Bitrate currently configured on the encoder. */
  current: number;
}

export function initialCongestion(bitrate: number): CongestionState {
  return {
    meanPostMs: null,
    failureStreak: 0,
    lastAdjustedAt: 0,
    current: bitrate,
  };
}

/** Fold one `post_chunk` result into the state. */
export function recordPost(
  state: CongestionState,
  sample: { durationMs: number; ok: boolean },
): CongestionState {
  const mean =
    state.meanPostMs === null
      ? sample.durationMs
      : state.meanPostMs * (1 - EWMA_ALPHA) + sample.durationMs * EWMA_ALPHA;
  return {
    ...state,
    meanPostMs: mean,
    failureStreak: sample.ok ? 0 : state.failureStreak + 1,
  };
}

/**
 * The bitrate the encoder should be running at.
 *
 * `requested` is the user's slider value and is treated as a ceiling — the
 * controller never exceeds what was asked for, it only backs off from it.
 * Returns the state unchanged when no adjustment is due, so the caller can
 * compare `current` to decide whether to reconfigure.
 */
export function nextBitrate(
  state: CongestionState,
  requested: number,
  now: number,
): CongestionState {
  // Honour a lowered ceiling immediately — the user moving the slider down is an
  // instruction, not a suggestion, and must not wait out the cooldown.
  if (state.current > requested) {
    return { ...state, current: requested, lastAdjustedAt: now };
  }

  const tripped = state.failureStreak >= FAILURE_STREAK_TRIP;
  if (!tripped && now - state.lastAdjustedAt < COOLDOWN_MS) return state;
  if (state.meanPostMs === null) return state;

  if (state.meanPostMs > CONGESTED_MS || tripped) {
    const stepped = Math.max(
      MIN_BITRATE,
      Math.round(state.current * BACKOFF_FACTOR),
    );
    if (stepped === state.current) return state;
    return {
      ...state,
      current: stepped,
      lastAdjustedAt: now,
      // Clear the streak so one bad patch causes one step, not a cascade.
      failureStreak: 0,
    };
  }

  if (state.meanPostMs < HEALTHY_MS && state.current < requested) {
    const stepped = Math.min(
      requested,
      Math.round(state.current * RECOVER_FACTOR),
    );
    if (stepped === state.current) return state;
    return { ...state, current: stepped, lastAdjustedAt: now };
  }

  return state;
}
