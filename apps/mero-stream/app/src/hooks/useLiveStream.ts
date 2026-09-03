import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { useMeroStream } from "./useMeroStream";
import {
  createDecoder,
  createEncoder,
  webCodecsAvailable,
  type DecoderHandle,
  type EncoderHandle,
  type ChunkPayload,
} from "../lib/webcodecs";
import {
  bytesCodec,
  maxPayloadBytes,
  decodeFragment,
  encodeFragments,
  FrameReassembler,
  nextMsgSeq,
} from "../lib/ephemeralFrames";
import { ProbeRecorder, type ProbeSnapshot } from "../lib/metrics";
import { acquireCamera } from "../lib/media";
import { evaluateSlots, type Claim, type SlotView } from "../lib/slots";
import {
  adaptiveEncoding,
  dutyCycle,
  pressure,
  sendBudget,
  type Pressure,
  type SendBudget,
} from "../lib/capacity";
import { initialCongestion, nextBitrate, recordPost } from "../lib/congestion";
import type { LiveStats } from "../types";

// 480p — the resolution approach 3 could never reach. Its toy in-WASM codec was
// pinned at 64x48 because the app had to produce bit-identical bytes on every
// node; here the browser encodes and the app only stores, so a hardware codec
// (and a real resolution) is available.
export const LIVE_WIDTH = 640;
export const LIVE_HEIGHT = 480;

// ~1.5 Mbps is a normal 480p30 live bitrate and lands ~188 KB/s of new state.
// That is roughly 9x a busy chat, versus ~230x for the same picture through
// approach 3's toy codec. Bitrate is the primary knob here, the way geometry was
// the primary knob there.
const DEFAULT_BITRATE = 1_500_000;

// Ask for a keyframe on this cadence. Two competing costs, both real:
// - keyframes are ~5-10x a delta frame, so frequent ones inflate state and disk
// - the reaper cannot prune past the newest keyframe, so a LONG gap pins the
//   whole window and live state stops being bounded
// - and a peer joining mid-stream sees nothing until the next one arrives
export const KEYFRAME_INTERVAL_MS = 2000;

// 25 fps by default (slider still reaches 30). Note this does NOT change the state
// rate: the encoder targets a fixed BITRATE, so 15 -> 25 fps buys smoothness at
// roughly the same ~188 KB/s and simply spends fewer bytes per frame. Raise the
// bitrate alongside fps if per-frame quality matters more than motion.
const DEFAULT_FPS = 25;

/**
 * Consecutive `set_ephemeral` failures, with no success ever, that are reported
 * as "this node cannot do ephemeral presence" rather than as a dropped frame.
 *
 * Named `…_UNSUPPORTED_AFTER`, not `…_FALLBACK_AFTER`: there is no transport left
 * to fall back TO, so tripping this produces a stated error naming the required
 * core version. The old name survived the transport removal and said the opposite
 * of what the code does.
 *
 * Not one, deliberately: a node that predates core 0.11.0-rc.24 rejects the
 * method every time, but a single transient failure on the very first frame
 * would otherwise be reported as a missing feature. Requiring a streak — and
 * only while nothing has ever succeeded — separates "this node cannot do it"
 * from "that one call didn't land".
 *
 * There is no longer a transport to fall back TO (see the module note above), so
 * tripping this is a hard, explained error instead of a silent demotion.
 */
const EPHEMERAL_UNSUPPORTED_AFTER = 3;

// Drop a sender's tile and decoder after this long without a chunk from them. Long
// enough to ride out a stall or a keyframe gap, short enough that someone who left
// does not linger as a frozen tile.
const PEER_TIMEOUT_MS = 6000;

/** Internal per-sender decode state. */
interface PeerState {
  from: string;
  /** When this sender CLAIMS it began broadcasting — remote input, not a fact. */
  startedAtMs: number;
  /**
   * Local ms at which we first saw a frame from this sender. Floors the claim
   * above so a spoofed `startedAtMs: 0` cannot squat a slot forever — see
   * `effectiveStart` in lib/slots.ts.
   */
  firstSeenAt: number;
  decoder: DecoderHandle | null;
  /** True once this sender's first keyframe has been seen — see the gate in `renderChunk`. */
  started: boolean;
  framesDecoded: number;
  lastSeenAt: number;
  width: number;
  height: number;
  codec: string;
}

/** One remote participant, as the UI needs to render it. */
export interface RemotePeer {
  from: string;
  /** When this sender began its current broadcast — the slot ranking key. */
  startedAtMs: number;
  width: number;
  height: number;
  framesDecoded: number;
  /** False until this sender's first keyframe lands; the tile is legitimately blank. */
  decoding: boolean;
}

export interface LiveController {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Remote participants, excluding ourselves. One tile each. */
  remotePeers: RemotePeer[];
  /** Register/unregister a tile's canvas so this sender's decoder can target it. */
  attachPeerCanvas: (from: string, el: HTMLCanvasElement | null) => void;
  running: boolean;
  /**
   * Start broadcasting. A no-op when {@link slots}`.mayClaim` is false — the
   * button is disabled there too, but the guard lives here so a stale click or a
   * driver script cannot open a fifth stream.
   */
  start: () => void;
  stop: () => void;
  /**
   * Broadcaster-slot occupancy.
   *
   * Recomputed on the 1 s reap tick, immediately after our own `start()`/`stop()`,
   * and when a NEW remote broadcaster's first frame arrives — the last of those
   * was missing, and the doc here claimed it anyway. It is not cosmetic: `start()`
   * gates on `slotsRef.current.mayClaim`, so a stale count let someone click
   * "Go live" into an already-full call and then get yielded a second later.
   * Bounded work — once per new sender, not per frame.
   */
  slots: SlotView;
  /** Set when this client yielded its own slot to earlier broadcasters. */
  yielded: boolean;
  /** Dismiss the yield notice (the "Go live" control re-arms on its own). */
  clearYielded: () => void;
  fps: number;
  setFps: (n: number) => void;
  /** The user's requested ceiling. */
  bitrate: number;
  setBitrate: (n: number) => void;
  /**
   * What the encoder is actually running at. Below `bitrate` means congestion
   * control has backed off — worth surfacing, because a silently degraded
   * picture with no explanation is how the retro's call felt from the inside.
   */
  effectiveBitrate: number;
  /**
   * The frame rate actually being captured: `fps` divided among the live
   * broadcasters. Surfaced because a call that quietly halves your frame rate
   * when someone else goes live, with nothing saying so, reads as the app
   * degrading for no reason. See `adaptiveFps` in lib/capacity.ts.
   */
  effectiveFps: number;
  /**
   * The send-loop budget for what is ACTUALLY being encoded.
   *
   * Computed here, once, rather than in each panel that displays it. Both the
   * control-bar strip and the data dialog derived it independently from raw
   * inputs, and they drifted: one used the slider ceiling and the other the
   * shared rate, so the two disagreed the moment a second broadcaster went live.
   * One source removes the class of bug rather than that instance of it.
   */
  budget: SendBudget;
  /**
   * Fraction of each second the serial send loop spends waiting on publishes, at
   * the measured publish RTT — plus its severity band.
   *
   * Here for the same reason `budget` is. Both panels derived this independently
   * from raw inputs, and `budget` was centralised precisely to close that class of
   * drift; leaving the next derived value in two places reopened it. The comment
   * in CallPage claiming "from the hook, not recomputed here" was already untrue
   * of `duty`.
   */
  duty: number;
  load: Pressure;
  /**
   * Replicated-state counters, refreshed only by {@link refreshStats}.
   *
   * On this transport they are all expected to stay at ZERO while the tiles are
   * moving — that is the proof the media never touched the DAG, not a broken
   * read. Polled on demand rather than every second because it is a contract
   * round-trip to read a table nothing writes to.
   */
  stats: LiveStats | null;
  refreshStats: () => void;
  probe: ProbeSnapshot;
  downloadCsv: () => void;
  resetProbe: () => void;
  /** null until checked; false means "this browser can't, use Chrome". */
  supported: boolean | null;
  error: string | null;
}

/**
 * The call loop: hardware-encode in the browser, carry the bytes on ephemeral
 * presence, decode one stream per remote sender.
 *
 * SEND: getUserMedia(640x480) -> VideoEncoder -> EncodedVideoChunk -> framed
 * into <=16 KiB fragments -> `set_ephemeral`. No WASM run, no state delta,
 * nothing in the DAG.
 *
 * RECEIVE: the `Ephemeral` event CARRIES the bytes -> reassemble -> VideoDecoder
 * -> canvas. There is no cursor and no backlog, so a joiner's only way in is to
 * wait out each sender's next keyframe (bounded by KEYFRAME_INTERVAL_MS): a
 * decoder fed a delta frame with no reference throws rather than degrading.
 *
 * `post_chunk` — writing every access unit into replicated state — used to be
 * the default here and switchable at runtime. It is gone from this path: it cost
 * ~188 KB/s of permanently-stored, tombstone-generating state plus a second
 * round-trip on receive, to deliver the same picture. The contract methods
 * remain (see useMeroStream) so the recorded Task-3 numbers stay reproducible,
 * but nothing in the call UI reaches them.
 */
export function useLiveStream(enabled: boolean): LiveController {
  const stream = useMeroStream();
  const streamRef = useRef(stream);
  streamRef.current = stream;

  // The MeroJs instance, for `mero.ephemeral`. mero-js only grew this surface in
  // 13.x (against core rc.24); on an older node every call fails and the app says
  // so outright — there is nothing to demote to. See EPHEMERAL_UNSUPPORTED_AFTER.
  const { mero } = useMero();
  const meroRef = useRef(mero);
  meroRef.current = mero;

  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const mediaRef = useRef<MediaStream | null>(null);
  const encoderRef = useRef<EncoderHandle | null>(null);

  // One decoder PER SENDER, keyed by member id. A single shared decoder was the
  // original design and it cannot work with more than one sender: two senders are
  // two independent H.264 bitstreams, and frame N from B is not a valid
  // continuation of frame N-1 from A. Interleaving them yields a decode error or a
  // smear, not a graceful degradation. `ChunkView.from` was always there; the
  // receive loop just discarded it.
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  // Canvases are owned by the page (one per tile) and registered here as they
  // mount, since a decoder needs its output surface at configure time.
  const peerCanvasRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastKeyframeAtRef = useRef(0);
  // Every sender observed in the RAW chunk stream, including ourselves.
  //
  // `msgSeq` is per sender and monotone, so each sender's seqs ARE contiguous
  // and a span-based gap count is meaningful. (It was not always: the contract
  // path allocated seqs from ONE shared space, so a second poster made any single
  // sender's seqs non-contiguous — 297 "gaps" in a run that lost nothing.)
  const sendersSeenRef = useRef<Set<string>>(new Set());
  const probeRef = useRef(new ProbeRecorder());

  // ── send-side framing state ─────────────────────────────────────────────────
  // Our own frame counter. Per SENDER and monotone: it is what lets a receiver
  // order and dedup fragments, and — because it changes every frame — what stops
  // two byte-identical frames in a row from making the second one invisible (the
  // node suppresses the delta event when a slice's bytes are unchanged).
  const sendSeqRef = useRef(0);
  const reassemblerRef = useRef<FrameReassembler | null>(null);
  const ephemeralFailsRef = useRef(0);
  const ephemeralOkRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);
  // What the encoder is ACTUALLY running at. `bitrate` is the user's ceiling;
  // congestion control only ever moves this below it. See lib/congestion.ts.
  const [effectiveBitrate, setEffectiveBitrate] = useState(DEFAULT_BITRATE);
  const congestionRef = useRef(initialCongestion(DEFAULT_BITRATE));
  // Mirrors `bitrate` for `onEncodedChunk`, which is intentionally dep-free so
  // its identity never changes (see the useMeroStream note on object identity).
  const bitrateRef = useRef(DEFAULT_BITRATE);

  const [stats, setStats] = useState<LiveStats | null>(null);
  // Monotonic request id for `refreshStats`, so a slow response cannot overwrite
  // a fresher one.
  const statsSeqRef = useRef(0);
  const [probe, setProbe] = useState<ProbeSnapshot>(() =>
    probeRef.current.snapshot(),
  );
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);

  // ── broadcaster slots ───────────────────────────────────────────────────────
  // When WE began our current broadcast. Stamped once at start and carried in
  // every frame header, because the ranking every peer computes has to agree on
  // it (see lib/slots.ts). A ref as well as state: `publishEphemeralFrame` is
  // deliberately dep-free, so it cannot read the state value.
  const startedAtRef = useRef<number | null>(null);
  const [slots, setSlots] = useState<SlotView>(() =>
    evaluateSlots({
      others: [],
      me: null,
      myStartedAtMs: null,
      nowMs: Date.now(),
      timeoutMs: PEER_TIMEOUT_MS,
    }),
  );
  const [yielded, setYielded] = useState(false);
  // The rate every broadcaster actually captures at. Divided among the live
  // broadcasters because the measured frame loss on this transport tracks the
  // AGGREGATE slice rate across the context, not the head-count — two people at
  // 13 fps put the same load on the wire as one at 25, which is the rate that
  // measured 96% delivery. `Math.max(1, …)` so a solo broadcaster is not divided
  // by the zero occupancy reported before its own claim lands.
  const shared = useMemo(
    () => adaptiveEncoding({ fps, bitrate }, Math.max(1, slots.occupied)),
    [fps, bitrate, slots.occupied],
  );
  const effectiveFps = shared.fps;
  const sharedBitrate = shared.bitrate;
  // Derived from what the encoder is actually running at, never from the slider.
  // Memoized for a STABLE REFERENCE as much as for the arithmetic: this is
  // returned on the controller and read by two panels, so re-allocating it every
  // 1 Hz tick would defeat any memoization those panels ever grow.
  const budget = useMemo(
    () =>
      sendBudget({
        fps: effectiveFps,
        bitrate: effectiveBitrate,
        keyframeIntervalMs: KEYFRAME_INTERVAL_MS,
        fragmentPayloadBytes: maxPayloadBytes(
          encoderRef.current?.codec ?? "avc1.42001f",
        ),
      }),
    [effectiveFps, effectiveBitrate],
  );

  // The CEILING congestion control works below, and it is the SHARED bitrate —
  // the slider divided among the live broadcasters — not the slider itself. Two
  // mechanisms stack here and they are different: sharing responds to how many
  // people are broadcasting, congestion control responds to how slowly publishes
  // are landing.
  //
  // A change to either takes effect at once and resets the controller's baseline.
  // Being walked back up in 1.25x steps after dragging the slider (or after a
  // broadcaster left) would read as the app ignoring you.
  useEffect(() => {
    bitrateRef.current = sharedBitrate;
    congestionRef.current = {
      ...congestionRef.current,
      current: sharedBitrate,
      lastAdjustedAt: Date.now(),
    };
    setEffectiveBitrate(sharedBitrate);
  }, [sharedBitrate]);

  // Measured, not assumed: `encodeMsP50` is the median time a publish took, which
  // for a serial send loop is exactly the number the budget is spent against.
  const duty = dutyCycle(budget, probe.encodeMsP50 ?? 0);

  // Read by `start`, which is dep-free so its identity stays stable.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  useEffect(() => setSupported(webCodecsAvailable()), []);

  // Release the claim whenever capture stops, for ANY reason — the yield path
  // and the error paths both clear `running` without going through `stop()`.
  // Leaving `startedAtRef` set would keep us ranked as a broadcaster while
  // publishing nothing, holding a slot against everyone else.
  useEffect(() => {
    if (running) return;
    startedAtRef.current = null;
  }, [running]);

  // Blank out seqGaps once a second REMOTE sender exists. Kept here rather than
  // inside ProbeRecorder so that module stays pure and framework-free: only the
  // receive loop knows how many members are actually posting.
  //
  // The threshold used to be "more than one sender at all", counting ourselves,
  // because every sender drew from one shared seq space — so the moment anyone
  // else posted, our own seqs went non-contiguous and the metric was fiction.
  // Seq spaces are per sender now and the probe already excludes our own chunks,
  // so a single remote sender's samples are contiguous and the gap count is real
  // again. That covers the ordinary two-person call, which is the case actually
  // being measured. Two or more remote senders still interleave in one sample
  // list, so the metric stays blanked there.
  const withGapValidity = useCallback((snap: ProbeSnapshot): ProbeSnapshot => {
    const me = streamRef.current.executorId;
    const remotes = [...sendersSeenRef.current].filter((s) => s !== me).length;
    return remotes > 1 ? { ...snap, seqGaps: null } : snap;
  }, []);

  // Mirror the peer map into React state. Sorted by member id so tiles keep a
  // stable order across renders instead of shuffling as chunks arrive.
  const publishPeers = useCallback(() => {
    setRemotePeers(
      [...peersRef.current.values()]
        .sort((a, b) => a.from.localeCompare(b.from))
        .map((p) => ({
          from: p.from,
          startedAtMs: p.startedAtMs,
          width: p.width,
          height: p.height,
          framesDecoded: p.framesDecoded,
          decoding: p.started,
        })),
    );
  }, []);

  /**
   * Recompute broadcaster-slot occupancy from the peer map and publish it.
   *
   * Occupancy is derived from the MEDIA STREAM itself — a broadcaster is anyone
   * whose frame arrived within PEER_TIMEOUT_MS, plus us while capturing. Nobody
   * publishes a separate claim record, and not for want of trying: presence is a
   * single-writer register per author, so a claim published between two frames
   * would be overwritten by the next frame. The media IS the claim, which is
   * also why `startedAtMs` had to go into the frame header.
   */
  const recomputeSlots = useCallback((): SlotView => {
    const claims: Claim[] = [...peersRef.current.values()].map((peer) => ({
      id: peer.from,
      startedAtMs: peer.startedAtMs,
      firstSeenAt: peer.firstSeenAt,
      lastSeenAt: peer.lastSeenAt,
    }));
    const view = evaluateSlots({
      others: claims,
      me: streamRef.current.executorId ?? null,
      myStartedAtMs: startedAtRef.current,
      nowMs: Date.now(),
      timeoutMs: PEER_TIMEOUT_MS,
    });
    setSlots(view);
    return view;
  }, []);

  const attachPeerCanvas = useCallback(
    (from: string, el: HTMLCanvasElement | null) => {
      if (el) {
        // Idempotent: React can call a ref with the same node again, and tearing
        // the decoder down for an unchanged surface would restart the keyframe
        // wait for nothing.
        if (peerCanvasRef.current.get(from) === el) return;
        peerCanvasRef.current.set(from, el);
      } else {
        peerCanvasRef.current.delete(from);
        // Tile unmounted: drop the decoder too, or it holds a surface that is gone.
        const peer = peersRef.current.get(from);
        peer?.decoder?.close();
        if (peer) {
          peer.decoder = null;
          // Force a fresh keyframe before decoding into a new canvas.
          peer.started = false;
        }
      }
    },
    [],
  );

  // ── RECEIVE ─────────────────────────────────────────────────────────────────
  //
  // `renderChunk` is the transport-INDEPENDENT half: peer bookkeeping, the
  // per-sender keyframe gate, decoder construction and self-heal, and the §4
  // probe sample. It is kept separate from the subscription that feeds it because
  // everything in here is about H.264 and WebCodecs, not about how the bytes
  // travelled. The decoder self-heal in particular was hard-won (see `onError`).
  const renderChunk = useCallback(
    (c: {
      from: string;
      /**
       * Sender-scoped, monotone frame number — the framing header's `msgSeq`.
       * Per-sender and never reused, which is all the gap metric needs.
       */
      seq: number;
      isKeyframe: boolean;
      width: number;
      height: number;
      codec: string;
      timestampUs: number;
      /** Sender wall clock, unix ms — the §4 latency numerator. */
      createdAt: number;
      /** When this sender began its current broadcast — the slot ranking key. */
      startedAtMs: number;
      data: ChunkPayload;
      encodedBytes: number;
    }) => {
      let peer = peersRef.current.get(c.from);
      if (!peer) {
        peer = {
          from: c.from,
          startedAtMs: c.startedAtMs,
          firstSeenAt: Date.now(),
          decoder: null,
          started: false,
          framesDecoded: 0,
          lastSeenAt: Date.now(),
          width: c.width,
          height: c.height,
          codec: c.codec,
        };
        peersRef.current.set(c.from, peer);
        publishPeers();
        // A new broadcaster changes occupancy, so the slot view must not wait for
        // the next tick. Only in this branch: `renderChunk` runs per frame, and
        // this is the one path where the peer SET changed.
        recomputeSlots();
      }
      peer.lastSeenAt = Date.now();
      // A sender that restarted its broadcast reports a NEW startedAtMs, and the
      // ranking must follow it — otherwise someone who stopped and came back
      // keeps their original priority forever, which is not first-come-first-
      // served any more.
      //
      // `firstSeenAt` is deliberately NOT refreshed here. It is our own record of
      // when this sender appeared, and it exists to floor the value on the line
      // above; moving it forward on every frame would let a sender walk its own
      // floor along and re-acquire the backdating advantage the floor removes.
      // A sender who genuinely leaves is dropped from the map by the reaper, and
      // gets a fresh `firstSeenAt` when they come back.
      peer.startedAtMs = c.startedAtMs;

      // PER-PEER KEYFRAME GATE. Each sender is an independent H.264 bitstream, so
      // a delta is only decodable against a keyframe FROM THE SAME SENDER.
      //
      // It is load-bearing on this transport: presence has no cursor and no
      // backlog at all. A joiner simply starts receiving whatever is being
      // published right now, which is a delta frame ~24 times out of 25, and its
      // only way in is to wait out the sender's next keyframe (bounded by
      // KEYFRAME_INTERVAL_MS).
      if (!peer.started) {
        if (!c.isKeyframe) return;
        peer.started = true;
      }

      const canvas = peerCanvasRef.current.get(c.from);
      if (!peer.decoder && canvas) {
        // Configure with the codec string THIS SENDER recorded, not an assumed one
        // or another peer's — both transports round-trip it verbatim, and two
        // senders can legitimately negotiate different profiles.
        const owner = peer;
        peer.decoder = createDecoder({
          canvas,
          codec: c.codec,
          // SELF-HEAL. A VideoDecoder that fires its error callback transitions to
          // `closed`, and every later decode() throws InvalidStateError — so before
          // this, ONE decode error froze that peer's tile permanently: decode rate
          // to 0, picture stuck, the other direction unaffected. That was the ~1-in-3
          // stall on a freshly-joined room, and it was not key delivery as suspected.
          //
          // A single missing reference frame is entirely expected here (the reaper
          // can prune a keyframe during a join, gossip can reorder, and a lost
          // fragment simply drops a frame), so the honest
          // response is to rebuild rather than to give up: drop the decoder and clear
          // `started`, and the gate above re-arms on this sender's next keyframe —
          // bounded by KEYFRAME_INTERVAL_MS.
          onError: (e) => {
            setError(e.message);
            owner.decoder?.close();
            owner.decoder = null;
            owner.started = false;
          },
        });
      }
      if (!peer.decoder) return; // tile not mounted yet; wait for the next keyframe

      try {
        peer.decoder.push({
          ...c.data,
          isKeyframe: c.isKeyframe,
          timestampUs: c.timestampUs,
        });
        peer.framesDecoded += 1;
      } catch (e) {
        // `decode()` throws synchronously on a closed decoder. Recover the same way
        // and keep going — one bad peer must not stall the shared receive path.
        setError(e instanceof Error ? e.message : "decode failed");
        peer.decoder?.close();
        peer.decoder = null;
        peer.started = false;
      }

      // §4 latency: `createdAt` is the SENDER's wall clock, so this includes any
      // skew between the two machines — trustworthy on the two-node harness where
      // both share a host clock, not across the internet. `rawBytes` is the
      // uncompressed frame the codec consumed, so compressionRatio reports what
      // the real codec bought us.
      probeRef.current.recordFrame({
        seq: c.seq,
        from: c.from,
        createdAt: c.createdAt,
        renderedAt: Date.now(),
        encodedBytes: c.encodedBytes,
        rawBytes: LIVE_WIDTH * LIVE_HEIGHT,
      });
    },
    // Both deps are `[]`-dep callbacks, so `renderChunk` keeps the stable
    // identity the subscription effect relies on.
    [publishPeers, recomputeSlots],
  );

  // ── RECEIVE: the frame rides the Ephemeral event itself ─────────────────────
  //
  // No cursors, no backlog, no read-back. A subscriber gets what is being
  // published now, which is why the keyframe gate in `renderChunk` is the only
  // way in and why a joiner waits out one KEYFRAME_INTERVAL_MS.
  //
  // `mero.ephemeral.subscribe` is used directly rather than mero-react's
  // `useEphemeral`, which is the wrong shape here: it maintains a
  // `Map<author, latest>` of merged partials, i.e. a presence REGISTER. This path
  // needs every delta as it arrives, because each one is a distinct frame — a
  // register would silently coalesce two frames into whichever landed last.
  useEffect(() => {
    if (!enabled) return;
    const contextId = stream.contextId;
    const ephemeral = mero?.ephemeral;
    if (!contextId || !ephemeral) return;

    const reassembler = new FrameReassembler();
    reassemblerRef.current = reassembler;

    const off = ephemeral.subscribe<Uint8Array>(
      contextId,
      (entry) => {
        const me = streamRef.current.executorId;

        // The node tells us a sender is gone — TTL sweep, disconnect, or an
        // author-cap eviction. Worth acting on directly rather than waiting for
        // PEER_TIMEOUT_MS, but NOT worth trusting as "that peer went offline":
        // core is explicit that a removal only means this node stopped tracking
        // them. Dropping the tile is right either way; they re-appear on their
        // next frame.
        if (entry.removed) {
          reassembler.forget(entry.author);
          const peer = peersRef.current.get(entry.author);
          if (peer) {
            peer.decoder?.close();
            peersRef.current.delete(entry.author);
            publishPeers();
          }
          return;
        }

        // `ageMs` present == a REPLAYED seed entry, not a live delta. On the
        // presence channel that is the store's current slice being handed to a
        // new subscriber (or to a reconnect), and for media it is by definition a
        // stale frame — up to the 7 s TTL old. Feeding it to a decoder would
        // paint a picture from seconds ago and, worse, could rewind the stream
        // past frames already shown. Absent-vs-zero is the whole signal here, so
        // this checks for absence and never for `> 0`.
        if (entry.ageMs !== undefined) return;
        if (!entry.state) return;

        const fragment = decodeFragment(entry.state);
        // Not ours: presence is one channel per context, shared with whatever
        // else publishes there. Silently ignored — see decodeFragment.
        if (!fragment) return;
        if (fragment.track !== 0) return; // video only; audio would ride track 1

        sendersSeenRef.current.add(entry.author); // BEFORE the self-skip below
        // Our own slice is echoed back to us by the node. The local preview
        // already shows it, and decoding it would double this machine's work for
        // no picture.
        if (me && entry.author === me) return;

        const frame = reassembler.push(entry.author, fragment);
        if (!frame) return; // incomplete, duplicated, or already superseded

        renderChunk({
          from: entry.author,
          seq: frame.msgSeq,
          isKeyframe: frame.isKeyframe,
          width: frame.width,
          height: frame.height,
          codec: frame.codec,
          timestampUs: frame.timestampUs,
          createdAt: frame.createdAtMs,
          startedAtMs: frame.startedAtMs,
          data: { bytes: frame.bytes },
          encodedBytes: frame.bytes.length,
        });
      },
      bytesCodec,
    );

    return () => {
      off();
      reassemblerRef.current = null;
    };
  }, [enabled, mero, stream.contextId, renderChunk, publishPeers]);

  // ── SEND ────────────────────────────────────────────────────────────────────
  /**
   * Publish one encoded frame as ephemeral presence, fragment by fragment.
   *
   * The fragments are awaited ONE AT A TIME, and that is not incidental. The node
   * assigns the per-author LWW seq synchronously when it accepts the call, and
   * drops any envelope whose seq is at or below the highest it has already
   * applied — so firing the fragments concurrently would race their seq
   * assignment and let the channel discard a fragment of a frame that was fully
   * published. Serialising costs one round-trip per fragment, which only
   * multi-fragment keyframes pay.
   *
   * Even serialised, delivery is best effort: the node's outbound publish is
   * spawned per call, so fragments can still reach a peer out of order, and the
   * loser is dropped. A single-fragment frame (every delta frame at these
   * bitrates) is unaffected; a multi-fragment keyframe that loses a fragment is
   * simply never reassembled, and the next keyframe — at most
   * KEYFRAME_INTERVAL_MS away — is the retry.
   */
  const publishEphemeralFrame = useCallback(
    async (c: {
      bytes: Uint8Array;
      isKeyframe: boolean;
      timestampUs: number;
    }) => {
      const contextId = streamRef.current.contextId;
      const ephemeral = meroRef.current?.ephemeral;
      if (!contextId || !ephemeral) {
        throw new Error("no node session for ephemeral presence");
      }

      const msgSeq = (sendSeqRef.current = nextMsgSeq(sendSeqRef.current));
      const fragments = encodeFragments({
        msgSeq,
        track: 0,
        isKeyframe: c.isKeyframe,
        width: LIVE_WIDTH,
        height: LIVE_HEIGHT,
        timestampUs: Math.max(0, Math.round(c.timestampUs)),
        createdAtMs: Date.now(),
        // Falls back to now rather than 0: a 0 here would rank us ahead of
        // everyone alive and hold a slot we never claimed.
        startedAtMs: startedAtRef.current ?? Date.now(),
        codec: encoderRef.current?.codec ?? "avc1.42001f",
        bytes: c.bytes,
      });

      for (const fragment of fragments) {
        await ephemeral.set<Uint8Array>(contextId, fragment, bytesCodec);
      }
    },
    [],
  );

  const onEncodedChunk = useCallback(
    async (c: {
      dataB64: string;
      bytes: Uint8Array;
      isKeyframe: boolean;
      timestampUs: number;
    }) => {
      const startedAt = Date.now();
      let ok = false;
      try {
        await publishEphemeralFrame(c);
        ephemeralOkRef.current = true;
        ephemeralFailsRef.current = 0;
        ok = true;
      } catch (e) {
        const detail = e instanceof Error ? e.message : "set_ephemeral failed";
        // A failure because the session is not up yet says nothing about what
        // the node can do, so it must not accumulate toward the capability
        // verdict below — the user would be told to upgrade a node that is
        // perfectly capable.
        const sessionReady = Boolean(meroRef.current);
        if (sessionReady) ephemeralFailsRef.current += 1;
        // A node that predates rc.24 has no `set_ephemeral` at all, and the
        // exact shape of its rejection is not something to guess at: a request
        // naming an unknown method fails to deserialize server-side, so this
        // reads the streak rather than a specific code. Only while NOTHING has
        // ever succeeded — after a first success, a failure is a dropped frame.
        if (
          sessionReady &&
          !ephemeralOkRef.current &&
          ephemeralFailsRef.current >= EPHEMERAL_UNSUPPORTED_AFTER
        ) {
          setError(
            `This node cannot carry media on ephemeral presence (needs core 0.11.0-rc.24 or newer). Last error: ${detail}`,
          );
        } else {
          setError(detail);
        }
      } finally {
        const durationMs = Date.now() - startedAt;
        probeRef.current.recordEncode({ startedAt, durationMs, ok });

        // Feed the send-side congestion controller. How long the publish takes —
        // the frame's `set_ephemeral` fragments — is the only view
        // the browser has of whether the node can absorb what we are producing;
        // libp2p transport state (relayed vs direct) is not exposed to the app. In
        // the retro's failed call the sender kept encoding at a fixed 1.5 Mbps
        // into a pipe that had stopped moving.
        //
        // `set_ephemeral` returns once the node has encrypted and queued the
        // slice, so this is a much tighter signal than `post_chunk`'s WASM run
        // plus storage commit ever was — but it is also the send loop's own
        // budget: fragments are published serially, so 26.5 slices/s at 25 fps
        // cannot outrun one publish RTT. See lib/capacity.ts.
        const now = Date.now();
        const folded = recordPost(congestionRef.current, { durationMs, ok });
        const next = nextBitrate(folded, bitrateRef.current, now);
        congestionRef.current = next;
        if (next.current !== folded.current) setEffectiveBitrate(next.current);
      }
    },
    // A `useCallback` with a stable identity, so this keeps the dep-free
    // property the encoder effect relies on (see the useMeroStream note).
    [publishEphemeralFrame],
  );

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    setError(null);
    // Captured now, used in cleanup. Reading `localVideoRef.current` at teardown
    // could see a different element (or null) after a re-render, which would
    // leave the old element still holding the camera MediaStream.
    const videoEl = localVideoRef.current;

    (async () => {
      try {
        if (!webCodecsAvailable()) {
          throw new Error(
            "WebCodecs VideoEncoder is unavailable in this browser — run this route in Chrome",
          );
        }
        const media = await acquireCamera({
          video: {
            width: LIVE_WIDTH,
            height: LIVE_HEIGHT,
            // `fps`, the user's ceiling — NOT the shared rate. See the dep array.
            frameRate: fps,
          },
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaRef.current = media;
        const video = videoEl;
        if (video) {
          video.srcObject = media;
          video.muted = true;
          await video.play().catch(() => {});
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "camera unavailable");
      }
    })();

    return () => {
      cancelled = true;
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
      if (videoEl) videoEl.srcObject = null;
    };
    // Keyed on `running` and the user's `fps` ONLY. Deliberately NOT on
    // `effectiveFps` or bitrate.
    //
    // `effectiveFps` changes whenever the number of live broadcasters changes,
    // which is not a user action — so depending on it here re-ran `getUserMedia`
    // every time someone else started or stopped: the webcam light blinks, the
    // track drops, and the picture goes black for a beat. On BOTH broadcasters at
    // once, at precisely the moment the transport is already losing frames to a
    // second sender. Adding churn to the worst moment is the opposite of what the
    // rate sharing is for.
    //
    // The camera's own `frameRate` is a constraint, not a clock: frames are fed to
    // the encoder by the capture interval below, which does track `effectiveFps`.
    // A live change is applied to the existing track instead — see the next effect.
  }, [running, fps]);

  // Apply a shared-rate change to the LIVE track rather than reacquiring it.
  //
  // `applyConstraints` is best effort and a device may refuse; that is fine and
  // is why the rejection is swallowed. It is a hint that lets the camera stop
  // producing frames nobody will encode — the capture interval is what actually
  // sets the rate, so failing to apply it costs a little power and nothing else.
  useEffect(() => {
    if (!running) return;
    const track = mediaRef.current?.getVideoTracks()[0];
    if (!track) return;
    void track.applyConstraints({ frameRate: effectiveFps }).catch(() => {
      /* device refused the hint — the capture interval still paces us */
    });
  }, [running, effectiveFps]);

  // The encoder is a SEPARATE effect from the camera on purpose.
  //
  // Congestion control steps `effectiveBitrate` while a call is running, and
  // WebCodecs has no reconfigure-in-place for a live VideoEncoder, so a step
  // means building a new one. When the camera and encoder shared one effect,
  // that also tore down `getUserMedia` — visibly dropping and re-acquiring the
  // webcam on every adjustment, which is unacceptable for a control loop meant
  // to run several times a minute on a congested link.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    (async () => {
      try {
        const enc = await createEncoder({
          width: LIVE_WIDTH,
          height: LIVE_HEIGHT,
          framerate: effectiveFps,
          bitrate: effectiveBitrate,
          onChunk: (c) => void onEncodedChunk(c),
          onError: (e) => setError(e.message),
        });
        if (cancelled) {
          enc.close();
          return;
        }
        encoderRef.current = enc;
        // A fresh encoder starts a new bitstream, so every receiver needs a
        // keyframe before it can decode again. Force one on the next capture
        // tick rather than making peers wait out KEYFRAME_INTERVAL_MS.
        lastKeyframeAtRef.current = 0;
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "encoder unavailable");
      }
    })();
    return () => {
      cancelled = true;
      encoderRef.current?.close();
      encoderRef.current = null;
    };
  }, [running, effectiveFps, effectiveBitrate, onEncodedChunk]);

  // Feed the encoder on a fixed cadence.
  useEffect(() => {
    if (!running) return;
    const period = Math.max(1, Math.round(1000 / Math.max(1, effectiveFps)));
    const id = setInterval(() => {
      const video = localVideoRef.current;
      const enc = encoderRef.current;
      if (!video || !enc || video.readyState < 2) return;
      const now = Date.now();
      const force = now - lastKeyframeAtRef.current >= KEYFRAME_INTERVAL_MS;
      if (force) lastKeyframeAtRef.current = now;
      try {
        enc.push(video, force);
      } catch (e) {
        setError(e instanceof Error ? e.message : "encode failed");
      }
    }, period);
    captureTimerRef.current = id;
    return () => clearInterval(id);
  }, [running, effectiveFps]);

  // ── Peer reaping + probe tick ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setProbe(withGapValidity(probeRef.current.snapshot()));
      // Reap senders that have gone quiet, and close their decoders. Leaking
      // decoders (and the VideoFrames they hold) stalls the whole pipeline once the
      // buffer pool drains — the same failure the single-peer path already had to
      // fix with disciplined `close()`.
      const cutoff = Date.now() - PEER_TIMEOUT_MS;
      let reaped = false;
      for (const [from, peer] of peersRef.current) {
        if (peer.lastSeenAt >= cutoff) continue;
        peer.decoder?.close();
        peersRef.current.delete(from);
        peerCanvasRef.current.delete(from);
        // Forgetting them in the reassembler drops any half-received frame AND
        // the replay gate, so a sender who comes back with a restarted msgSeq is
        // not mistaken for a replay of the old one and muted for good.
        reassemblerRef.current?.forget(from);
        reaped = true;
      }
      // Republish every tick so framesDecoded/decoding stay live in the UI.
      publishPeers();
      if (reaped) probeRef.current.snapshot();

      // Yield OUR OWN capture, and only ever our own. Nothing here can stop
      // another participant — see the note at the top of lib/slots.ts for why
      // that asymmetry is what makes a cooperative cap safe to ship.
      if (recomputeSlots().mustYield) {
        setYielded(true);
        setRunning(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, publishPeers, withGapValidity, recomputeSlots]);

  useEffect(
    () => () => {
      for (const peer of peersRef.current.values()) peer.decoder?.close();
      peersRef.current.clear();
      peerCanvasRef.current.clear();
      sendersSeenRef.current.clear();
      reassemblerRef.current = null;
    },
    [],
  );

  const downloadCsv = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([probeRef.current.toCsv()], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `mero-stream-live-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /**
   * Read the replicated-state counters once.
   *
   * NOT on the 1 s tick. On this transport every counter here is expected to
   * stay at zero for the whole call — that is the measurement — so polling it
   * every second is a contract round-trip to read a table nothing writes to.
   * The data dialog calls this while it is open and nobody pays for it while it
   * is closed.
   */
  const refreshStats = useCallback(() => {
    // Sequenced AND caught. Two separate problems with the obvious one-liner:
    //
    //   * No `.catch()` makes a transient RPC failure an unhandled rejection,
    //     where every other polling path in this app swallows it and lets the
    //     next tick retry.
    //   * No sequencing means that if a round-trip ever outlives the dialog's 1 s
    //     tick (slow node, relayed link, GC pause), an older response can land
    //     after a newer one and overwrite fresh state with stale — in the panel
    //     whose whole job is to be an accurate proof that nothing was written.
    const seq = ++statsSeqRef.current;
    void streamRef.current
      .getLiveStats()
      .then((v) => {
        if (seq !== statsSeqRef.current) return; // superseded
        if (v) setStats(v);
      })
      .catch(() => {
        /* transient RPC error — the dialog's next tick retries */
      });
  }, []);

  /**
   * Claim a broadcaster slot and start capturing.
   *
   * `startedAtMs` is stamped HERE, before the camera is even open, so it is the
   * moment we claimed rather than the moment the first frame happened to encode.
   * Camera permission can take seconds and the encoder another beat; using a
   * later instant would make a slow device lose every race to a fast one that
   * clicked after it.
   */
  const start = useCallback(() => {
    // Re-checked here and not only on the button: a stale click, or a driver
    // script, must not be able to open a fifth stream. `slotsRef` rather than
    // `slots` so this callback keeps a stable identity.
    if (startedAtRef.current !== null) return; // already claiming
    if (!slotsRef.current.mayClaim) return;
    startedAtRef.current = Date.now();
    setYielded(false);
    setRunning(true);
    // Reflect the claim at once instead of waiting out the 1 s tick, so the
    // occupancy readout does not lag the button that changed it.
    recomputeSlots();
  }, [recomputeSlots]);

  const stop = useCallback(() => {
    startedAtRef.current = null;
    setRunning(false);
    recomputeSlots();
  }, [recomputeSlots]);

  const clearYielded = useCallback(() => setYielded(false), []);

  const resetProbe = useCallback(() => {
    probeRef.current.reset();
    setProbe(withGapValidity(probeRef.current.snapshot()));
  }, [withGapValidity]);

  return {
    localVideoRef,
    remotePeers,
    attachPeerCanvas,
    running,
    start,
    stop,
    slots,
    yielded,
    clearYielded,
    fps,
    setFps,
    bitrate,
    setBitrate,
    effectiveBitrate,
    effectiveFps,
    budget,
    duty,
    load: pressure(duty),
    stats,
    refreshStats,
    probe,
    downloadCsv,
    resetProbe,
    supported,
    error,
  };
}
