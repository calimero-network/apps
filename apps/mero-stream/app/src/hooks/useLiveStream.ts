import { useCallback, useEffect, useRef, useState } from "react";
import { useSubscription } from "@calimero-network/mero-react";
import { useMeroStream } from "./useMeroStream";
import {
  createDecoder,
  createEncoder,
  webCodecsAvailable,
  type DecoderHandle,
  type EncoderHandle,
} from "../lib/webcodecs";
import { ProbeRecorder, type ProbeSnapshot } from "../lib/metrics";
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
  bitrate: number;
  setBitrate: (n: number) => void;
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
 * The first read starts at keyframe_cursor(), not at the newest seq: a decoder
 * fed a delta frame with no reference throws rather than degrading.
 */
export function useLiveStream(enabled: boolean): LiveController {
  const stream = useMeroStream();
  const streamRef = useRef(stream);
  streamRef.current = stream;

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
  // Every sender observed in the RAW chunk stream, including ourselves. Seq gaps
  // are only computable while this holds one entry: the contract allocates seqs from
  // a shared space, so a second poster makes any single sender's seqs non-contiguous
  // and a span-based count pure fiction (297 "gaps" in a run that lost nothing).
  // Note the probe's own samples cannot detect this — they exclude our own chunks,
  // so they always look single-sender.
  const sendersSeenRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef(0);
  const cursorInitialisedRef = useRef(false);
  const probeRef = useRef(new ProbeRecorder());

  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [probe, setProbe] = useState<ProbeSnapshot>(() =>
    probeRef.current.snapshot(),
  );
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);

  useEffect(() => setSupported(webCodecsAvailable()), []);

  // Blank out seqGaps once a second sender exists. Kept here rather than inside
  // ProbeRecorder so that module stays pure and framework-free: only the receive
  // loop knows how many members are actually posting.
  const withGapValidity = useCallback(
    (snap: ProbeSnapshot): ProbeSnapshot =>
      sendersSeenRef.current.size > 1 ? { ...snap, seqGaps: null } : snap,
    [],
  );

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
  const drainOnce = useCallback(async () => {
    // ONE fetch cursor for everybody. get_chunks(after_seq) already returns every
    // sender's chunks from a shared seq space, so a per-peer cursor would mean N
    // round-trips for the same data. Demux happens below, per `from`.
    if (!cursorInitialisedRef.current) {
      const kf = await streamRef.current.keyframeCursor();
      if (kf === null || kf === undefined) return; // nothing decodable yet
      cursorRef.current = kf - 1;
      cursorInitialisedRef.current = true;
    }

    const chunks = await streamRef.current.getChunks(cursorRef.current);
    if (!chunks || chunks.length === 0) return;

    const me = streamRef.current.executorId;
    let sawNewPeer = false;

    for (const c of chunks) {
      if (c.seq > cursorRef.current) cursorRef.current = c.seq;
      if (c.track !== 0) continue; // video only for now; audio rides track 1
      sendersSeenRef.current.add(c.from); // BEFORE the self-skip below

      // Never decode our own stream: the local preview already shows it, and
      // decoding it would double the receiver's work for no picture.
      if (me && c.from === me) continue;

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
        sawNewPeer = true;
      }
      peer.lastSeenAt = Date.now();

      // PER-PEER KEYFRAME GATE. Each sender is an independent H.264 bitstream, so
      // a delta is only decodable against a keyframe FROM THE SAME SENDER. The
      // contract's `keyframe_cursor()` is a single global pointer (whoever
      // keyframed last), so the initial cursor is mid-GOP for every other sender —
      // and the reaper, which clamps to that same global pointer, can prune one
      // sender's only keyframe while protecting another's.
      //
      // Gating here instead of tracking keyframes per sender in contract state
      // makes both harmless without changing the state layout (which would break
      // existing contexts and force a republish): we simply skip a sender's deltas
      // until their next keyframe arrives, which is bounded by
      // KEYFRAME_INTERVAL_MS. Cost is up to that much black tile for a late joiner.
      if (!peer.started) {
        if (!c.isKeyframe) continue;
        peer.started = true;
      }

      const canvas = peerCanvasRef.current.get(c.from);
      if (!peer.decoder && canvas) {
        // Configure with the codec string THIS SENDER recorded, not an assumed one
        // or another peer's — the app round-trips it verbatim, and two senders can
        // legitimately negotiate different profiles.
        peer.decoder = createDecoder({
          canvas,
          codec: c.codec,
          onError: (e) => setError(e.message),
        });
      }
      if (!peer.decoder) continue; // tile not mounted yet; wait for the next keyframe

      peer.decoder.push({
        dataB64: c.dataB64,
        isKeyframe: c.isKeyframe,
        timestampUs: c.timestampUs,
      });
      peer.framesDecoded += 1;

      // §4 latency, same two-clock caveat as approach 3: createdAt is the sender's
      // wall clock. rawBytes is the UNCOMPRESSED frame the codec consumed, so
      // compressionRatio reports what the real codec bought us.
      probeRef.current.recordFrame({
        seq: c.seq,
        from: c.from,
        createdAt: c.createdAt,
        renderedAt: Date.now(),
        encodedBytes: Math.floor((c.dataB64.length * 3) / 4),
        rawBytes: LIVE_WIDTH * LIVE_HEIGHT,
      });
    }

    if (sawNewPeer) publishPeers();
  }, [publishPeers]);

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

  // ── SEND ────────────────────────────────────────────────────────────────────
  const onEncodedChunk = useCallback(
    async (c: {
      dataB64: string;
      isKeyframe: boolean;
      timestampUs: number;
    }) => {
      const startedAt = Date.now();
      let ok = false;
      try {
        await streamRef.current.postChunk({
          dataB64: c.dataB64,
          track: 0,
          isKeyframe: c.isKeyframe,
          codec: encoderRef.current?.codec ?? "avc1.42001f",
          width: LIVE_WIDTH,
          height: LIVE_HEIGHT,
          timestampUs: Math.max(0, Math.round(c.timestampUs)),
        });
        ok = true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "post_chunk failed");
      } finally {
        probeRef.current.recordEncode({
          startedAt,
          durationMs: Date.now() - startedAt,
          ok,
        });
      }
    },
    [],
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
        encoderRef.current = await createEncoder({
          width: LIVE_WIDTH,
          height: LIVE_HEIGHT,
          framerate: fps,
          bitrate,
          onChunk: (c) => void onEncodedChunk(c),
          onError: (e) => setError(e.message),
        });
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "camera/encoder unavailable",
          );
      }
    })();

    return () => {
      cancelled = true;
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      encoderRef.current?.close();
      encoderRef.current = null;
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
      if (videoEl) videoEl.srcObject = null;
    };
  }, [running, fps, bitrate, onEncodedChunk]);

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
  const onEvent = useCallback(
    (evt: { data: unknown }) => {
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
    if (!enabled) return;
    void drain();
    const id = setInterval(() => void drain(), RECEIVE_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, drain]);

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
    bitrate,
    setBitrate,
    stats,
    probe,
    downloadCsv,
    resetProbe,
    supported,
    error,
  };
}
