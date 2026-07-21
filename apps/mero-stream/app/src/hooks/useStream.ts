import { useCallback, useEffect, useRef, useState } from "react";
import { useSubscription } from "@calimero-network/mero-react";
import { useMeroStream } from "./useMeroStream";
import { captureFrameLuma, paintLuma } from "../lib/luma";
import type { StreamStats } from "../types";

// Capture geometry — the send side downscales the webcam to exactly this before
// handing luma to the contract. Tiny on purpose (geometry is the primary knob on
// the Task-3 load curve; the contract caps a raw frame at 256×256).
export const CAPTURE_WIDTH = 64;
export const CAPTURE_HEIGHT = 48;

// Video track id the contract expects for luma (0 = video luma; 1 would be audio).
const TRACK_VIDEO_LUMA = 0;

// Slow poll fallback for the receive loop, in case an SSE FramePosted nudge is
// missed. SSE carries the urgency; this just keeps the decoded canvas honest.
const RECEIVE_POLL_MS = 2000;

export interface StreamController {
  /** Attach to the local capture PREVIEW canvas (shows the tiny luma we send). */
  localCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Attach to the REMOTE decoded canvas (frames drained via get_frame). */
  remoteCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  running: boolean;
  fps: number;
  setFps: (n: number) => void;
  start: () => void;
  stop: () => void;
  stats: StreamStats | null;
  /** Encoded byte size of the most recently rendered remote frame. */
  lastEncodedBytes: number | null;
  error: string | null;
}

/**
 * The capture + receive loop — the heart of the Task-3 probe.
 *
 * SEND: getUserMedia → a hidden <video> → on an interval (default 3 fps) grab a
 * downscaled luma frame (captureFrameLuma) and push it through the contract's
 * `encode_frame`. The raw luma never leaves this node; only the WASM-compressed
 * fragment gossips.
 *
 * RECEIVE: subscribe to the context's SSE stream; on `FramePosted` drain via
 * `get_frame(cursor)`, paint each decoded frame's luma to the remote canvas, and
 * advance the cursor. A slow poll backs up the SSE nudge.
 *
 * We also poll `get_stats` each capture tick so the metrics panel charts the
 * failure curve live.
 *
 * Effect-dep discipline follows mero-meet's useCall: the memoized `stream` object
 * is held in a ref so the capture interval and drain closures always reach the
 * live client without being torn down every render.
 */
export function useStream(enabled: boolean): StreamController {
  const stream = useMeroStream();
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const remoteCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Capture plumbing kept in refs — none of it belongs in React state (it never
  // renders), and refs keep the interval closure stable.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const encodingRef = useRef(false); // single-flight: never overlap encode calls
  const drainingRef = useRef(false); // single-flight: never overlap drains
  // Highest frame seq we've already rendered. We drain everything strictly newer.
  const cursorRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(3);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [lastEncodedBytes, setLastEncodedBytes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── RECEIVE: drain + paint decoded frames ───────────────────────────────────
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      const frames = await streamRef.current.getFrame(cursorRef.current);
      if (!frames || frames.length === 0) return;
      const canvas = remoteCanvasRef.current;
      const ctx = canvas?.getContext("2d") ?? null;
      for (const f of frames) {
        if (f.seq > cursorRef.current) cursorRef.current = f.seq;
        setLastEncodedBytes(f.encodedBytes);
        if (canvas && ctx) {
          // Size the canvas to the frame geometry, then blit the decoded luma.
          if (canvas.width !== f.width) canvas.width = f.width;
          if (canvas.height !== f.height) canvas.height = f.height;
          paintLuma(ctx, f.width, f.height, f.pixels);
        }
      }
    } catch {
      /* transient RPC error — the poll / next SSE nudge retries */
    } finally {
      drainingRef.current = false;
    }
  }, []);

  // ── SEND: one capture tick ───────────────────────────────────────────────────
  const captureTick = useCallback(async () => {
    const video = videoRef.current;
    const scratch = scratchRef.current;
    if (!video || !scratch || video.readyState < 2) return; // no frame yet
    if (encodingRef.current) return; // don't queue behind a slow encode
    encodingRef.current = true;
    try {
      const luma = captureFrameLuma(video, scratch, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      // Mirror the exact bytes we send to the LOCAL preview canvas, so the
      // operator sees precisely what the contract receives (not the raw webcam).
      const preview = localCanvasRef.current;
      const pctx = preview?.getContext("2d") ?? null;
      if (preview && pctx) {
        if (preview.width !== CAPTURE_WIDTH) preview.width = CAPTURE_WIDTH;
        if (preview.height !== CAPTURE_HEIGHT) preview.height = CAPTURE_HEIGHT;
        paintLuma(pctx, CAPTURE_WIDTH, CAPTURE_HEIGHT, luma);
      }
      await streamRef.current.encodeFrame(luma, CAPTURE_WIDTH, CAPTURE_HEIGHT, TRACK_VIDEO_LUMA);
      // Poll stats on the same cadence — cheap, and keeps the metrics live.
      const s = await streamRef.current.getStats();
      if (s) setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "capture/encode failed");
    } finally {
      encodingRef.current = false;
    }
  }, []);

  // ── Start / stop the camera + capture interval when running flips ────────────
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaRef.current = media;
        // Hidden off-DOM video element — we only ever read frames off it.
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = media;
        await video.play().catch(() => {});
        videoRef.current = video;
        scratchRef.current = document.createElement("canvas");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "camera unavailable");
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
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
      scratchRef.current = null;
    };
  }, [running]);

  // Capture interval — separate effect so changing `fps` re-arms it without
  // tearing down the camera.
  useEffect(() => {
    if (!running) return;
    const period = Math.max(1, Math.round(1000 / Math.max(1, fps)));
    const id = setInterval(() => void captureTick(), period);
    captureTimerRef.current = id;
    return () => clearInterval(id);
  }, [running, fps, captureTick]);

  // ── React to SSE events (snappy receive) ─────────────────────────────────────
  const onEvent = useCallback(
    (evt: { data: unknown }) => {
      const data = evt.data as Record<string, unknown> | null;
      const type = data && typeof data === "object" ? Object.keys(data)[0] : "";
      if (type === "FramePosted") void drain();
    },
    [drain],
  );
  useSubscription(enabled && stream.contextId ? [stream.contextId] : [], onEvent);

  // Poll fallback for the receive side + an initial drain when enabled.
  useEffect(() => {
    if (!enabled) return;
    void drain();
    const id = setInterval(() => void drain(), RECEIVE_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, drain]);

  const start = useCallback(() => setRunning(true), []);
  const stop = useCallback(() => setRunning(false), []);

  return {
    localCanvasRef,
    remoteCanvasRef,
    running,
    fps,
    setFps,
    start,
    stop,
    stats,
    lastEncodedBytes,
    error,
  };
}
