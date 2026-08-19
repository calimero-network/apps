import { useCallback, useEffect, useRef, useState } from "react";
import { useMero, useSubscription } from "@calimero-network/mero-react";
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
  decodeFragment,
  encodeFragments,
  FrameReassembler,
  nextMsgSeq,
} from "../lib/ephemeralFrames";
import { ProbeRecorder, type ProbeSnapshot } from "../lib/metrics";
import { initialCongestion, nextBitrate, recordPost } from "../lib/congestion";
import type { LiveStats, SenderCursor } from "../types";

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
const KEYFRAME_INTERVAL_MS = 2000;

// Safety net only — SSE ChunkPosted carries the urgency, and `drain` now coalesces
// rather than dropping notifications, so this no longer sets the latency floor.
//
// It used to be 1000 ms AND drain() dropped any event arriving mid-flight, so the
// next fetch waited for this timer: latency landed roughly uniformly in 0..1000 ms,
// i.e. mean ~500 ms / p95 ~950 ms. Measured before the fix: p50 505 ms, p95 960 ms.
// The distribution WAS this constant.
const RECEIVE_POLL_MS = 250;

// 25 fps by default (slider still reaches 30). Note this does NOT change the state
// rate: the encoder targets a fixed BITRATE, so 15 -> 25 fps buys smoothness at
// roughly the same ~188 KB/s and simply spends fewer bytes per frame. Raise the
// bitrate alongside fps if per-frame quality matters more than motion.
const DEFAULT_FPS = 25;

/**
 * How the encoded bytes travel between peers.
 *
 * * `contract` — approach 2, unchanged: `post_chunk` writes every access unit
 *   into replicated state (~188 KB/s of new state at 1.5 Mbps), a `ChunkPosted`
 *   event notifies, the receiver reads it back with `get_chunks`, and the
 *   keyframe-clamped reaper walks the window back with tombstones.
 * * `ephemeral` — approach 1, new in core 0.11.0-rc.24 (core#3427): the bytes
 *   ride an ephemeral-presence slice. Never persisted, never in the DAG, no WASM
 *   run, swept by the node on a 7 s TTL, and delivered IN the event — so the
 *   receiver's `get_chunks` round-trip disappears too.
 *
 * The default stays `contract` on purpose. This app is a capacity probe and its
 * published numbers are that path's; the switch exists so the two can be
 * measured back to back in one run, on one machine, against the same camera —
 * which is a far stronger comparison than two separate sessions. See
 * lib/ephemeralFrames.ts for what the ephemeral channel costs to use.
 */
export type LiveTransport = "contract" | "ephemeral";

/**
 * Consecutive `set_ephemeral` failures, with no success ever, that demote the
 * transport back to `contract`.
 *
 * Not one, deliberately: a node that predates rc.24 rejects the method every
 * time, but a single transient failure on the very first frame would otherwise
 * strand the whole session on the contract path. Requiring a streak — and only
 * while nothing has ever succeeded — separates "this node cannot do it" from
 * "that one call didn't land".
 */
const EPHEMERAL_FALLBACK_AFTER = 3;

// Drop a sender's tile and decoder after this long without a chunk from them. Long
// enough to ride out a stall or a keyframe gap, short enough that someone who left
// does not linger as a frozen tile.
const PEER_TIMEOUT_MS = 6000;

/** Internal per-sender decode state. */
interface PeerState {
  from: string;
  decoder: DecoderHandle | null;
  /** True once this sender's first keyframe has been seen — see the gate in `drainOnce`. */
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
  start: () => void;
  stop: () => void;
  fps: number;
  setFps: (n: number) => void;
  /** How the encoded bytes travel. See {@link LiveTransport}. */
  transport: LiveTransport;
  setTransport: (t: LiveTransport) => void;
  /** The user's requested ceiling. */
  bitrate: number;
  setBitrate: (n: number) => void;
  /**
   * What the encoder is actually running at. Below `bitrate` means congestion
   * control has backed off — worth surfacing, because a silently degraded
   * picture with no explanation is how the retro's call felt from the inside.
   */
  effectiveBitrate: number;
  stats: LiveStats | null;
  probe: ProbeSnapshot;
  downloadCsv: () => void;
  resetProbe: () => void;
  /** null until checked; false means "this browser can't, use Chrome". */
  supported: boolean | null;
  error: string | null;
}

/**
 * The approach-2 loop: hardware-encode in the browser, replicate opaque bytes.
 *
 * SEND: getUserMedia(640x480) -> VideoEncoder -> EncodedVideoChunk -> base64 ->
 * post_chunk. The app stores the bytes without understanding them.
 *
 * RECEIVE: on ChunkPosted (SSE) -> get_chunks(cursor) -> VideoDecoder -> canvas.
 * A joiner sends an empty cursor set and the contract starts each sender at that
 * sender's own newest keyframe: a decoder fed a delta frame with no reference
 * throws rather than degrading.
 */
export function useLiveStream(enabled: boolean): LiveController {
  const stream = useMeroStream();
  const streamRef = useRef(stream);
  streamRef.current = stream;

  // The MeroJs instance, for `mero.ephemeral`. mero-js only grew this surface in
  // 13.x (against core rc.24); on an older node the calls fail and the transport
  // demotes itself — see EPHEMERAL_FALLBACK_AFTER.
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
  const drainingRef = useRef(false);
  // Set when a notification arrives while a drain is already running, so the drain
  // repeats instead of the notification being lost. See `drain`.
  const drainPendingRef = useRef(false);
  // Every sender observed in the RAW chunk stream, including ourselves.
  //
  // This used to carry a caveat that seq gaps were only computable with a single
  // sender, because the contract allocated seqs from ONE shared space and a
  // second poster made any single sender's seqs non-contiguous (297 "gaps" in a
  // run that lost nothing). Seq spaces are per sender now, so each sender's seqs
  // ARE contiguous and a span-based gap count is meaningful again regardless of
  // how many people are in the call.
  const sendersSeenRef = useRef<Set<string>>(new Set());
  // Read position per sender — see `drainOnce`. A sender absent from this map
  // has never been seen, and the contract starts them at their own newest
  // keyframe.
  const cursorsRef = useRef<Map<string, number>>(new Map());
  const probeRef = useRef(new ProbeRecorder());

  // ── ephemeral transport state ───────────────────────────────────────────────
  // Our own frame counter. Per SENDER and monotone: it is what lets a receiver
  // order and dedup fragments, and — because it changes every frame — what stops
  // two byte-identical frames in a row from making the second one invisible (the
  // node suppresses the delta event when a slice's bytes are unchanged).
  const sendSeqRef = useRef(0);
  const reassemblerRef = useRef<FrameReassembler | null>(null);
  const ephemeralFailsRef = useRef(0);
  const ephemeralOkRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [transport, setTransportState] = useState<LiveTransport>("contract");
  // Read by `onEncodedChunk`, which is deliberately dep-free so its identity
  // never changes (see the useMeroStream note on object identity) — a state read
  // there would capture the value from the render that created it.
  const transportRef = useRef<LiveTransport>("contract");
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);
  // What the encoder is ACTUALLY running at. `bitrate` is the user's ceiling;
  // congestion control only ever moves this below it. See lib/congestion.ts.
  const [effectiveBitrate, setEffectiveBitrate] = useState(DEFAULT_BITRATE);
  const congestionRef = useRef(initialCongestion(DEFAULT_BITRATE));
  // Mirrors `bitrate` for `onEncodedChunk`, which is intentionally dep-free so
  // its identity never changes (see the useMeroStream note on object identity).
  const bitrateRef = useRef(DEFAULT_BITRATE);

  // The slider is authoritative. A manual change takes effect at once and resets
  // the controller's baseline — being walked back up in 1.25x steps after
  // dragging the slider would read as the app ignoring you.
  useEffect(() => {
    bitrateRef.current = bitrate;
    congestionRef.current = {
      ...congestionRef.current,
      current: bitrate,
      lastAdjustedAt: Date.now(),
    };
    setEffectiveBitrate(bitrate);
  }, [bitrate]);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [probe, setProbe] = useState<ProbeSnapshot>(() =>
    probeRef.current.snapshot(),
  );
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);

  useEffect(() => setSupported(webCodecsAvailable()), []);

  /**
   * Switch transport, resetting everything that is transport-scoped.
   *
   * Decoders are dropped rather than kept: a decoder mid-GOP on one transport
   * cannot continue from the other's first frame (which is a delta ~24 times out
   * of 25), so keeping it would just throw and self-heal a beat later. Clearing
   * the peers re-arms the keyframe gate, which is the honest way in.
   */
  const setTransport = useCallback((next: LiveTransport) => {
    transportRef.current = next;
    setTransportState(next);
    ephemeralFailsRef.current = 0;
    ephemeralOkRef.current = false;
    for (const peer of peersRef.current.values()) peer.decoder?.close();
    peersRef.current.clear();
    cursorsRef.current.clear();
    setRemotePeers([]);
  }, []);

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
          width: p.width,
          height: p.height,
          framesDecoded: p.framesDecoded,
          decoding: p.started,
        })),
    );
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
  // probe sample. Both transports land here — `post_chunk` + `get_chunks`
  // (approach 2) and ephemeral presence (approach 1) — because everything below
  // is about H.264 and WebCodecs, not about how the bytes travelled. The decoder
  // self-heal in particular was hard-won (see `onError`), and having one copy of
  // it is the only way both transports keep it.
  const renderChunk = useCallback(
    (c: {
      from: string;
      /**
       * Sender-scoped, monotone frame number. The contract's chunk `seq` on one
       * transport and the framing header's `msgSeq` on the other; both are
       * per-sender and never reused, which is all the gap metric needs.
       */
      seq: number;
      isKeyframe: boolean;
      width: number;
      height: number;
      codec: string;
      timestampUs: number;
      /** Sender wall clock, unix ms — the §4 latency numerator. */
      createdAt: number;
      data: ChunkPayload;
      encodedBytes: number;
    }) => {
      let peer = peersRef.current.get(c.from);
      if (!peer) {
        peer = {
          from: c.from,
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
      }
      peer.lastSeenAt = Date.now();

      // PER-PEER KEYFRAME GATE. Each sender is an independent H.264 bitstream, so
      // a delta is only decodable against a keyframe FROM THE SAME SENDER.
      //
      // On the contract transport this used to be the ONLY protection: there was
      // one global keyframe pointer (whoever keyframed last), so a joiner's
      // cursor landed mid-GOP for every other sender, and the reaper — clamping
      // to that same global pointer — could prune one sender's only keyframe
      // while protecting another's. Both are fixed in the contract now
      // (per-sender keyframes, per-sender reaper), so there it is defence in
      // depth rather than the load-bearing fix.
      //
      // On the ephemeral transport it is load-bearing again, and for a different
      // reason: presence has no cursor and no backlog at all. A joiner simply
      // starts receiving whatever is being published right now, which is a delta
      // frame ~24 times out of 25, and its only way in is to wait out the sender's
      // next keyframe (bounded by KEYFRAME_INTERVAL_MS).
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
          // can prune a keyframe during a join, gossip can reorder, and on the
          // ephemeral transport a lost fragment simply drops a frame), so the honest
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
    [publishPeers],
  );

  // ── RECEIVE, approach 2: notify (ChunkPosted) then read (get_chunks) ─────────
  //
  // COALESCES rather than drops. The guard used to be a bare
  // `if (drainingRef.current) return;`, which threw away every `ChunkPosted` that
  // arrived while a fetch was in flight — and nothing rescheduled, so the next read
  // waited for the fallback poll. With that poll at 1 s, latency landed roughly
  // uniformly in 0..1000 ms: mean ~500 ms, p95 ~950 ms. Measured p50 505 / p95 960,
  // i.e. the "slow receiver" was this guard, not the network and not the decoder
  // (which already runs `optimizeForLatency: true`).
  //
  // Now a mid-flight notification sets `drainPendingRef` and the loop below repeats
  // once. Bounded — one extra pass per burst, no unbounded recursion — and no
  // notification is lost.
  //
  // The ephemeral transport has no equivalent: the frame bytes ride the event
  // itself, so there is nothing to go back and fetch.
  const drainOnce = useCallback(async () => {
    // ONE cursor PER SENDER. Seq spaces are per sender in the contract, so a
    // single global cursor cannot express "I am at 40 in Alice's stream and 12
    // in Bob's" — and the shared counter it used to read from is exactly what
    // made two senders overwrite each other (see retro/review.md).
    //
    // Still one round-trip: `get_chunks` takes the whole cursor set at once.
    // Senders we have never seen are omitted, and the contract starts those at
    // their own newest keyframe — which is what the separate `keyframeCursor()`
    // call used to do, badly, with a single global pointer.
    const cursors: SenderCursor[] = [...cursorsRef.current].map(
      ([from, afterSeq]) => ({ from, afterSeq }),
    );

    const chunks = await streamRef.current.getChunks(cursors);
    if (!chunks || chunks.length === 0) return;

    const me = streamRef.current.executorId;

    for (const c of chunks) {
      const seen = cursorsRef.current.get(c.from) ?? 0;
      if (c.seq > seen) cursorsRef.current.set(c.from, c.seq);
      if (c.track !== 0) continue; // video only for now; audio rides track 1
      sendersSeenRef.current.add(c.from); // BEFORE the self-skip below

      // Never decode our own stream: the local preview already shows it, and
      // decoding it would double the receiver's work for no picture.
      if (me && c.from === me) continue;

      renderChunk({
        from: c.from,
        seq: c.seq,
        isKeyframe: c.isKeyframe,
        width: c.width,
        height: c.height,
        codec: c.codec,
        timestampUs: c.timestampUs,
        createdAt: c.createdAt,
        data: { dataB64: c.dataB64 },
        encodedBytes: Math.floor((c.dataB64.length * 3) / 4),
      });
    }
  }, [renderChunk]);

  const drain = useCallback(async () => {
    if (drainingRef.current) {
      drainPendingRef.current = true;
      return;
    }
    drainingRef.current = true;
    try {
      // Repeat while notifications arrived mid-flight. `drainOnce` keeps its early
      // returns; the loop lives out here so those returns cannot skip a pending
      // pass. Bounded by how fast chunks actually arrive, not unbounded recursion.
      do {
        drainPendingRef.current = false;
        await drainOnce();
      } while (drainPendingRef.current);
    } catch {
      /* transient RPC error — SSE or the poll retries */
    } finally {
      drainingRef.current = false;
      drainPendingRef.current = false;
    }
  }, [drainOnce]);

  // ── RECEIVE, approach 1: the frame rides the Ephemeral event itself ──────────
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
    if (!enabled || transport !== "ephemeral") return;
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
  }, [enabled, transport, mero, stream.contextId, renderChunk, publishPeers]);

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
      const via = transportRef.current;
      let ok = false;
      try {
        if (via === "ephemeral") {
          await publishEphemeralFrame(c);
          ephemeralOkRef.current = true;
          ephemeralFailsRef.current = 0;
        } else {
          await streamRef.current.postChunk({
            dataB64: c.dataB64,
            track: 0,
            isKeyframe: c.isKeyframe,
            codec: encoderRef.current?.codec ?? "avc1.42001f",
            width: LIVE_WIDTH,
            height: LIVE_HEIGHT,
            timestampUs: Math.max(0, Math.round(c.timestampUs)),
          });
        }
        ok = true;
      } catch (e) {
        const detail =
          e instanceof Error
            ? e.message
            : via === "ephemeral"
              ? "set_ephemeral failed"
              : "post_chunk failed";
        if (via === "ephemeral") {
          // A failure because the session is not up yet says nothing about what
          // the node can do, so it must not accumulate toward the capability
          // verdict below — the user would be told to upgrade a node that is
          // perfectly capable.
          const sessionReady = Boolean(meroRef.current);
          if (sessionReady) ephemeralFailsRef.current += 1;
          // A node that predates rc.24 has no `set_ephemeral` at all, and the
          // exact shape of its rejection is not something to guess at: a request
          // naming an unknown method fails to deserialize server-side, so this
          // reads the streak rather than a specific code. Demote only while
          // NOTHING has ever succeeded — after a first success, a failure is a
          // dropped frame, not a missing feature.
          if (
            sessionReady &&
            !ephemeralOkRef.current &&
            ephemeralFailsRef.current >= EPHEMERAL_FALLBACK_AFTER
          ) {
            setTransport("contract");
            setError(
              `Ephemeral presence is unavailable on this node (needs core 0.11.0-rc.24) — fell back to post_chunk. Last error: ${detail}`,
            );
          } else {
            setError(detail);
          }
        } else {
          setError(detail);
        }
      } finally {
        const durationMs = Date.now() - startedAt;
        probeRef.current.recordEncode({ startedAt, durationMs, ok });

        // Feed the send-side congestion controller. How long the publish takes —
        // `post_chunk` or the frame's `set_ephemeral` fragments — is the only view
        // the browser has of whether the node can absorb what we are producing;
        // libp2p transport state (relayed vs direct) is not exposed to the app. In
        // the retro's failed call the sender kept encoding at a fixed 1.5 Mbps
        // into a pipe that had stopped moving.
        //
        // The two transports are not measured on the same scale and the panel says
        // so: `post_chunk` waits on a WASM run plus a storage commit, while
        // `set_ephemeral` returns once the node has encrypted and queued the
        // slice. The controller only ever compares a transport against itself, so
        // it stays meaningful either way.
        const now = Date.now();
        const folded = recordPost(congestionRef.current, { durationMs, ok });
        const next = nextBitrate(folded, bitrateRef.current, now);
        congestionRef.current = next;
        if (next.current !== folded.current) setEffectiveBitrate(next.current);
      }
    },
    // Both are `useCallback`s with stable identities, so this keeps the dep-free
    // property the encoder effect relies on (see the useMeroStream note).
    [publishEphemeralFrame, setTransport],
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
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: LIVE_WIDTH, height: LIVE_HEIGHT, frameRate: fps },
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
    // Deliberately NOT keyed on bitrate — see the encoder effect below.
  }, [running, fps]);

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
          framerate: fps,
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
  }, [running, fps, effectiveBitrate, onEncodedChunk]);

  // Feed the encoder on a fixed cadence.
  useEffect(() => {
    if (!running) return;
    const period = Math.max(1, Math.round(1000 / Math.max(1, fps)));
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
  }, [running, fps]);

  // ── SSE + fallback poll + stats ──────────────────────────────────────────────
  // ChunkPosted is approach 2's notification that there is something to read
  // back. The ephemeral transport delivers the bytes in its own event, so both
  // this and the fallback poll below stay off there — polling `get_chunks` on
  // that path would burn a round-trip a second to read a table nothing writes to.
  const onEvent = useCallback(
    (evt: { data: unknown }) => {
      if (transportRef.current !== "contract") return;
      const data = evt.data as Record<string, unknown> | null;
      const type = data && typeof data === "object" ? Object.keys(data)[0] : "";
      if (type === "ChunkPosted") void drain();
    },
    [drain],
  );
  useSubscription(
    enabled && stream.contextId ? [stream.contextId] : [],
    onEvent,
  );

  useEffect(() => {
    if (!enabled || transport !== "contract") return;
    void drain();
    const id = setInterval(() => void drain(), RECEIVE_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, transport, drain]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setProbe(withGapValidity(probeRef.current.snapshot()));
      void streamRef.current.getLiveStats().then((s) => s && setStats(s));

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
        // Drop their cursor too, so if they come back they are treated as a
        // fresh sender and the contract starts them at their own newest
        // keyframe. Keeping the stale cursor would replay whatever backlog
        // accumulated while they were gone, oldest-first, before reaching
        // anything current.
        cursorsRef.current.delete(from);
        // Same reasoning on the ephemeral transport: forgetting them drops any
        // half-received frame AND the replay gate, so a sender who comes back
        // with a restarted msgSeq is not mistaken for a replay of the old one and
        // muted for good.
        reassemblerRef.current?.forget(from);
        reaped = true;
      }
      // Republish every tick so framesDecoded/decoding stay live in the UI.
      publishPeers();
      if (reaped) probeRef.current.snapshot();
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, publishPeers, withGapValidity]);

  useEffect(
    () => () => {
      for (const peer of peersRef.current.values()) peer.decoder?.close();
      peersRef.current.clear();
      peerCanvasRef.current.clear();
      cursorsRef.current.clear();
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

  const resetProbe = useCallback(() => {
    probeRef.current.reset();
    setProbe(withGapValidity(probeRef.current.snapshot()));
  }, [withGapValidity]);

  return {
    localVideoRef,
    remotePeers,
    attachPeerCanvas,
    running,
    start: useCallback(() => setRunning(true), []),
    stop: useCallback(() => setRunning(false), []),
    fps,
    setFps,
    transport,
    setTransport,
    bitrate,
    setBitrate,
    effectiveBitrate,
    stats,
    probe,
    downloadCsv,
    resetProbe,
    supported,
    error,
  };
}
