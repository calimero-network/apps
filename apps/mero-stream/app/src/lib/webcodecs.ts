// ── Approach 2: real codec in the browser, app as a dumb replicated pipe ───────
//
// Approach 3 runs a toy integer codec inside the WASM app. That caps us at 64x48
// greyscale, because the app must produce bit-identical output on every node
// (C1) and real codecs are float-heavy and non-deterministic across builds.
//
// Approach 2 inverts it: the BROWSER encodes with WebCodecs — hardware H.264 —
// and the WASM app stores bytes it never interprets. No node computes the media,
// so determinism is not at stake, and a real codec's ~60x compression becomes
// available. That is the whole reason 480p is on the table here and was not there.
//
// What this module is NOT: a media framework. It is the thinnest wrapper that
// turns a <video> into a stream of opaque chunks and back, because everything
// interesting (the replication cost) is measured elsewhere.

/** Base64 for the JSON-RPC hop. See ChunkView::data_b64 in logic/src/lib.rs. */
export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid blowing the argument limit on String.fromCharCode with a
  // 60 KB keyframe — apply() with tens of thousands of args throws in some
  // engines, and it would only fail on keyframes, i.e. intermittently.
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Is WebCodecs video encoding usable in this browser at all?
 *
 * Worth checking explicitly rather than letting a constructor throw: Chrome and
 * Edge have had it for a while, Safari/WKWebView only from 16.4, and the Calimero
 * desktop shell is WKWebView on macOS. A missing VideoEncoder is a "run this in
 * Chrome" message, not a bug.
 */
export function webCodecsAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder ===
      "function" &&
    typeof (window as unknown as { VideoDecoder?: unknown }).VideoDecoder ===
      "function"
  );
}

/** What the sender hands the app for one encoded chunk. */
export interface OutboundChunk {
  dataB64: string;
  isKeyframe: boolean;
  timestampUs: number;
  byteLength: number;
}

export interface EncoderHandle {
  /** Push one frame from the <video>. `force` requests a keyframe. */
  push: (source: HTMLVideoElement, force: boolean) => void;
  close: () => void;
  /** The exact codec string the peer's decoder must be configured with. */
  codec: string;
}

/**
 * Configure a hardware H.264 encoder that emits chunks via `onChunk`.
 *
 * Two configuration choices carry real weight:
 *
 * - `avc: { format: "annexb" }`. The alternative (avcC) requires the decoder to
 *   receive out-of-band `description` bytes (SPS/PPS) before it can decode
 *   anything. That would mean storing extradata as extra replicated state and
 *   getting a peer to fetch it before its first frame. Annex-B carries SPS/PPS
 *   inline in the keyframes, so a peer needs nothing but the chunks themselves —
 *   which is exactly the property that keeps the WASM app a dumb pipe.
 * - `latencyMode: "realtime"`. Without it the encoder buffers frames to improve
 *   compression, adding latency we are specifically here to measure.
 */
export async function createEncoder(opts: {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
  codec?: string;
  onChunk: (chunk: OutboundChunk) => void;
  onError: (err: Error) => void;
}): Promise<EncoderHandle> {
  const codec = opts.codec ?? "avc1.42001f"; // H.264 baseline, level 3.1
  const Encoder = (window as unknown as { VideoEncoder: typeof VideoEncoder })
    .VideoEncoder;

  const encoder = new Encoder({
    output: (chunk: EncodedVideoChunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      opts.onChunk({
        dataB64: bytesToBase64(buf),
        isKeyframe: chunk.type === "key",
        timestampUs: chunk.timestamp,
        byteLength: chunk.byteLength,
      });
    },
    error: (e: DOMException) =>
      opts.onError(new Error(`encoder: ${e.message}`)),
  });

  encoder.configure({
    codec,
    width: opts.width,
    height: opts.height,
    framerate: opts.framerate,
    bitrate: opts.bitrate,
    latencyMode: "realtime",
    avc: { format: "annexb" },
  });

  return {
    codec,
    push: (source, force) => {
      // A VideoFrame holds a GPU/native buffer and MUST be closed or the pipeline
      // stalls after a handful of frames when the pool is exhausted. encode()
      // does not take ownership.
      const frame = new VideoFrame(source, {
        timestamp: performance.now() * 1000,
      });
      try {
        encoder.encode(frame, { keyFrame: force });
      } finally {
        frame.close();
      }
    },
    close: () => {
      try {
        encoder.close();
      } catch {
        /* already closed */
      }
    },
  };
}

export interface DecoderHandle {
  /** Feed one chunk. Must arrive in seq order, keyframe first. */
  push: (c: {
    dataB64: string;
    isKeyframe: boolean;
    timestampUs: number;
  }) => void;
  close: () => void;
}

/**
 * Configure a decoder that paints onto a canvas.
 *
 * `configure` is deferred until the first chunk so we can use the codec string
 * the sender actually recorded, rather than assuming both sides agreed — the app
 * round-trips it verbatim precisely so this cannot drift.
 */
export function createDecoder(opts: {
  canvas: HTMLCanvasElement;
  codec: string;
  onFrame?: (timestampUs: number) => void;
  onError: (err: Error) => void;
}): DecoderHandle {
  const Decoder = (window as unknown as { VideoDecoder: typeof VideoDecoder })
    .VideoDecoder;
  const ctx = opts.canvas.getContext("2d");

  const decoder = new Decoder({
    output: (frame: VideoFrame) => {
      try {
        if (ctx) {
          if (opts.canvas.width !== frame.displayWidth) {
            opts.canvas.width = frame.displayWidth;
            opts.canvas.height = frame.displayHeight;
          }
          ctx.drawImage(frame, 0, 0);
        }
        opts.onFrame?.(frame.timestamp ?? 0);
      } finally {
        // Same ownership rule as the encoder: leaking VideoFrames stalls decode.
        frame.close();
      }
    },
    error: (e: DOMException) =>
      opts.onError(new Error(`decoder: ${e.message}`)),
  });

  decoder.configure({ codec: opts.codec, optimizeForLatency: true });

  // A decoder fed a delta frame before any keyframe throws rather than producing
  // a grey picture, so drop deltas until the first keyframe has been seen. The
  // app's keyframe_cursor() is what normally prevents this; this is the local
  // belt-and-braces for a peer that started draining mid-GOP anyway.
  let sawKeyframe = false;

  return {
    push: (c) => {
      if (!sawKeyframe && !c.isKeyframe) return;
      sawKeyframe = true;
      decoder.decode(
        new EncodedVideoChunk({
          type: c.isKeyframe ? "key" : "delta",
          timestamp: c.timestampUs,
          data: base64ToBytes(c.dataB64),
        }),
      );
    },
    close: () => {
      try {
        decoder.close();
      } catch {
        /* already closed */
      }
    },
  };
}
