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

// Fallback drain cadence; SSE ChunkPosted carries the urgency.
const RECEIVE_POLL_MS = 1000;

export interface LiveController {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteCanvasRef: React.RefObject<HTMLCanvasElement | null>;
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
  const remoteCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const mediaRef = useRef<MediaStream | null>(null);
  const encoderRef = useRef<EncoderHandle | null>(null);
  const decoderRef = useRef<DecoderHandle | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastKeyframeAtRef = useRef(0);
  const drainingRef = useRef(false);
  const cursorRef = useRef(0);
  const cursorInitialisedRef = useRef(false);
  const probeRef = useRef(new ProbeRecorder());

  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(15);
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [probe, setProbe] = useState<ProbeSnapshot>(() =>
    probeRef.current.snapshot(),
  );
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSupported(webCodecsAvailable()), []);

  // ── RECEIVE ─────────────────────────────────────────────────────────────────
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      // First read: jump to the newest keyframe. Anything earlier is a delta we
      // have no reference for, and starting there would just throw in the decoder.
      if (!cursorInitialisedRef.current) {
        const kf = await streamRef.current.keyframeCursor();
        if (kf === null || kf === undefined) return; // nothing decodable yet
        cursorRef.current = kf - 1;
        cursorInitialisedRef.current = true;
      }

      const chunks = await streamRef.current.getChunks(cursorRef.current);
      if (!chunks || chunks.length === 0) return;

      for (const c of chunks) {
        if (c.track !== 0) continue; // video only for now; audio rides track 1
        if (!decoderRef.current && remoteCanvasRef.current) {
          // Configure with the codec string the SENDER recorded, not an assumed
          // one — the app round-trips it verbatim so these cannot drift.
          decoderRef.current = createDecoder({
            canvas: remoteCanvasRef.current,
            codec: c.codec,
            onError: (e) => setError(e.message),
          });
        }
        decoderRef.current?.push({
          dataB64: c.dataB64,
          isKeyframe: c.isKeyframe,
          timestampUs: c.timestampUs,
        });
        if (c.seq > cursorRef.current) cursorRef.current = c.seq;

        // §4 latency, same two-clock caveat as approach 3: createdAt is the
        // sender's wall clock. rawBytes here is the UNCOMPRESSED frame the codec
        // consumed, so compressionRatio reports what the real codec bought us.
        probeRef.current.recordFrame({
          seq: c.seq,
          createdAt: c.createdAt,
          renderedAt: Date.now(),
          encodedBytes: Math.floor((c.dataB64.length * 3) / 4),
          rawBytes: LIVE_WIDTH * LIVE_HEIGHT,
        });
      }
    } catch {
      /* transient RPC error — SSE or the poll retries */
    } finally {
      drainingRef.current = false;
    }
  }, []);

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
      setProbe(probeRef.current.snapshot());
      void streamRef.current.getLiveStats().then((s) => s && setStats(s));
    }, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(
    () => () => {
      decoderRef.current?.close();
      decoderRef.current = null;
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
    setProbe(probeRef.current.snapshot());
  }, []);

  return {
    localVideoRef,
    remoteCanvasRef,
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
