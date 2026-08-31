// ── Capacity budget ───────────────────────────────────────────────────────────
//
// Turns the encoder settings into the two numbers that actually decide whether a
// call holds up, and lets the UI put a MEASURED value next to each:
//
//   1. `slicesPerSecond` — how many `set_ephemeral` calls the send loop must
//      complete per second. Fragments are published SERIALLY (they have to be:
//      the node assigns the per-author LWW seq when it accepts the call, so
//      firing them concurrently races that assignment and lets the channel drop
//      a fragment of a fully published frame). So the send loop's whole budget
//      is `1 / slicesPerSecond` per publish, and the ceiling this implies —
//      `maxSustainableRttMs` — is usually the FIRST thing a call hits, before
//      any bandwidth limit. It is also independent of how many people are in the
//      call.
//   2. `upstreamBitsPerSecond` — what gossipsub's fan-out costs this node. See
//      ./slots.ts for the derivation and for why the cap is what it is.
//
// Pure and framework-free, so both are unit-testable without a node, a camera or
// a network.

/**
 * Bytes a keyframe costs relative to a delta frame.
 *
 * The one ESTIMATE in this module, and it is an estimate: the real ratio depends
 * on the scene, and a static camera in a lit room sits well below a moving one.
 * 8 is the middle of the usual 5–10 range for 480p H.264. It only affects how
 * the same total bitrate is *distributed* across frames, so it moves the
 * fragment count (and therefore `slicesPerSecond`) but never the byte rate — a
 * wrong guess here cannot make the bandwidth arithmetic wrong.
 */
export const KEYFRAME_COST_RATIO = 8;

export interface SendBudgetInput {
  fps: number;
  /** Encoder target, bits per second. */
  bitrate: number;
  keyframeIntervalMs: number;
  /** Payload bytes per presence slice — `maxPayloadBytes(codec)`. */
  fragmentPayloadBytes: number;
}

export interface SendBudget {
  /** Estimated bytes in one delta frame. */
  deltaBytes: number;
  /** Estimated bytes in one keyframe. */
  keyframeBytes: number;
  /** Presence slices a keyframe fragments into. */
  keyframeFragments: number;
  /** Presence slices a delta frame fragments into (1 at ordinary bitrates). */
  deltaFragments: number;
  /** `set_ephemeral` calls per second the send loop must complete. */
  slicesPerSecond: number;
  /**
   * Publish RTT at which the serial send loop saturates — i.e. spends a full
   * second of every second waiting. Above this, frames are dropped no matter how
   * much bandwidth is free.
   */
  maxSustainableRttMs: number;
}

/** Fragments a frame of `bytes` splits into. A zero-byte frame still sends one. */
function fragmentsFor(bytes: number, payloadCap: number): number {
  if (payloadCap <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(bytes / payloadCap));
}

export function sendBudget(input: SendBudgetInput): SendBudget {
  const fps = Math.max(1, input.fps);
  const intervalSec = Math.max(0.001, input.keyframeIntervalMs / 1000);
  const framesPerInterval = Math.max(1, Math.round(fps * intervalSec));
  const bytesPerInterval = (Math.max(0, input.bitrate) / 8) * intervalSec;

  // One keyframe per interval, the rest deltas, sharing the interval's byte
  // budget in the KEYFRAME_COST_RATIO proportion:
  //   (framesPerInterval - 1) * delta + ratio * delta = bytesPerInterval
  const deltaCount = framesPerInterval - 1;
  const deltaBytes = bytesPerInterval / (deltaCount + KEYFRAME_COST_RATIO);
  const keyframeBytes = deltaBytes * KEYFRAME_COST_RATIO;

  const deltaFragments = fragmentsFor(deltaBytes, input.fragmentPayloadBytes);
  const keyframeFragments = fragmentsFor(
    keyframeBytes,
    input.fragmentPayloadBytes,
  );

  const fragmentsPerInterval =
    deltaCount * deltaFragments + keyframeFragments * 1;
  const slicesPerSecond = fragmentsPerInterval / intervalSec;

  return {
    deltaBytes,
    keyframeBytes,
    deltaFragments,
    keyframeFragments,
    slicesPerSecond,
    maxSustainableRttMs:
      slicesPerSecond > 0 ? 1000 / slicesPerSecond : Number.POSITIVE_INFINITY,
  };
}

/**
 * Fraction of each second the serial send loop spends waiting on publishes, at a
 * measured publish RTT. At 1 it is saturated and dropping frames.
 */
export function dutyCycle(budget: SendBudget, rttMs: number): number {
  if (!Number.isFinite(rttMs) || rttMs < 0) return 0;
  return (budget.slicesPerSecond * rttMs) / 1000;
}

/**
 * Gossipsub mesh target in core
 * (`GOSSIPSUB_MESH_N`, core/crates/network/primitives/src/config.rs).
 *
 * Mirrored rather than imported for the obvious reason — this is a browser — so
 * it is a value to re-check when core's networking config moves, not a guess.
 */
export const GOSSIPSUB_MESH_N = 4;

/**
 * Upstream bits/s this node spends, given the participant and broadcaster counts.
 *
 * `flood_publish(true)` sends our OWN publishes to every subscribed peer
 * directly; forwarding of everyone else's follows the mesh, to
 * `min(N-1, mesh_n) - 1` peers (mesh minus whoever we got it from). Receivers
 * dedupe the duplicates, but the bytes are already on the wire, so they count.
 *
 * Direct connections only. Behind a relay the whole call crosses one circuit —
 * see the relay note in ./slots.ts.
 */
export function upstreamBitsPerSecond(args: {
  participants: number;
  broadcasters: number;
  bitrate: number;
  /** Whether THIS node is one of the broadcasters. */
  broadcasting: boolean;
}): number {
  const n = Math.max(1, args.participants);
  const s = Math.max(0, args.broadcasters);
  const peers = n - 1;
  const meshDegree = Math.min(peers, GOSSIPSUB_MESH_N);
  const forwardFanout = Math.max(0, meshDegree - 1);
  const others = Math.max(0, s - (args.broadcasting ? 1 : 0));
  const own = args.broadcasting ? peers : 0;
  return args.bitrate * (own + others * forwardFanout);
}

/**
 * ── The measured behaviour of this transport, including what did NOT work ─────
 *
 * `workflows/e2e-capacity-ladder.yml` ran four real nodes at 640x480 / 1.5 Mbps
 * and counted what a subscriber actually received:
 *
 *     authors   fps   bitrate     sent fps   RTT p50/p95    DELIVERED
 *     1         25    1.5 Mbps    24.9       5 / 15 ms      96 %
 *     2         25    1.5 Mbps    24.5       9 / 33 ms      43 %
 *     3         25    1.5 Mbps    20.2       14 / 115 ms    22 %
 *     4         25    1.5 Mbps    17.5       14 / 153 ms    45 %
 *     2         13    1.5 Mbps    12.9       9 / 28 ms      70 %
 *     2         13    0.75 Mbps   12.9       8 / 39 ms      61 %
 *
 * The first four rows say the send side is fine and the transport is not: at two
 * authors, 24.5 of 25 fps published with zero errors and under half arrived.
 * Presence is a single-writer LWW register per author and the node drops an
 * envelope whose seq is at or below the highest applied, so a reorder costs a
 * frame outright.
 *
 * The last two rows are a NEGATIVE RESULT and they are why this comment is long.
 * The obvious theory was that loss tracks the AGGREGATE publish rate, so sharing
 * the budget between broadcasters should restore it. Two authors at 13 fps put
 * ~27.8 slices/s on the wire between them — the same aggregate as the single
 * author who saw 96% — and delivery reached only 70%, then 61% once the bitrate
 * was halved as well (which did fix the fragment shape: keyframes went back to 4
 * fragments from 7). Within the noise of a 12 s sample those two are the same
 * number, and neither is 96%.
 *
 * **So aggregate rate is not the variable. Concurrent AUTHOR COUNT is.** Whatever
 * costs the frames is per-author on the node's inbound path, and no client-side
 * pacing reaches it. That is a core-side investigation, recorded as a follow-up.
 *
 * What the sharing below is therefore FOR, stated honestly: it does not recover
 * delivery and is not claimed to. It halves each node's upstream and keeps
 * publish RTT low, both of which are real and worth having, and it keeps the
 * fragment shape identical to the healthy solo case instead of inflating
 * keyframes to seven fragments. It is load reduction, not a fix.
 */
export const MIN_ADAPTIVE_FPS = 10;

/**
 * Floor on the shared bitrate. Below this, 640x480 H.264 stops being a picture
 * of anything.
 */
export const MIN_ADAPTIVE_BITRATE = 400_000;

export interface Encoding {
  fps: number;
  bitrate: number;
}

/**
 * Split one call's encoding budget among the live broadcasters.
 *
 * BOTH knobs. Dividing only the frame rate leaves a fixed bitrate spread over
 * fewer frames, so each frame grows and a keyframe went from ~53 KB (4 fragments)
 * to ~101 KB (SEVEN) — and a seven-fragment keyframe loses a fragment far more
 * readily. Dividing the bitrate too keeps every frame the same shape as the
 * healthy solo case.
 *
 * ⚠️ Read the block comment above before assuming this fixes delivery. It does
 * not; that was measured and disproved. It reduces load — upstream, publish RTT,
 * fragment count — and nothing more.
 *
 * The floors are what MAX_BROADCASTERS is really protecting: once dividing would
 * push a broadcaster under ~10 fps or ~400 kbps there is nothing left to divide,
 * and refusing the next broadcaster is more honest than handing everyone an
 * unwatchable stream.
 */
/** Per-broadcaster frame rate: the ceiling divided among the live broadcasters. */
export function adaptiveFps(baseFps: number, broadcasters: number): number {
  const base = Math.max(1, Math.round(baseFps));
  const live = Math.max(1, Math.round(broadcasters));
  // `Math.min(floor, base)` so a caller who deliberately chose a low rate is
  // never pushed UP by the floor.
  return Math.max(Math.min(MIN_ADAPTIVE_FPS, base), Math.round(base / live));
}

export function adaptiveEncoding(
  base: Encoding,
  broadcasters: number,
): Encoding {
  const live = Math.max(1, Math.round(broadcasters));
  return {
    fps: adaptiveFps(base.fps, live),
    // `Math.min(floor, base)` so a caller who deliberately chose a low bitrate is
    // never pushed UP by the floor.
    bitrate: Math.max(
      Math.min(MIN_ADAPTIVE_BITRATE, Math.max(0, base.bitrate)),
      Math.round(Math.max(0, base.bitrate) / live),
    ),
  };
}

export type Pressure = "ok" | "tight" | "over";

/**
 * Classify a duty cycle. Thresholds are deliberately conservative: the send loop
 * shares the main thread with the encoder and the decoders, so "70% of the
 * budget spent waiting" is already a call that stutters rather than one with 30%
 * to spare.
 */
export function pressure(duty: number): Pressure {
  if (duty >= 1) return "over";
  if (duty >= 0.7) return "tight";
  return "ok";
}
