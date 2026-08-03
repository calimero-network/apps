// Mirrors the WASM contract's serde output (camelCase). Keep in sync with
// logic/src/lib.rs. Mero Stream deliberately pushes media THROUGH the contract
// (Task 3 capacity probe) — these are the read-model shapes the frontend paints.

/** A member of the stream context. Membership gates `encode_frame`. */
export interface Member {
  memberId: string;
  username: string;
  joinedAt: number;
  updatedAt: number;
}

/**
 * A frame reconstructed IN WASM by the contract's decoder. `pixels` is raw luma
 * (1 byte/pixel, row-major, `width * height` long) — the frontend paints it to a
 * canvas. `encodedBytes` is the summed compressed size of the stored fragments,
 * so the UI can chart compression ratio without a second call.
 */
export interface DecodedFrame {
  seq: number;
  from: string;
  track: number;
  width: number;
  height: number;
  /** Raw luma, `width * height` bytes (0-255). */
  pixels: number[];
  createdAt: number;
  encodedBytes: number;
}

/**
 * Instrumentation snapshot (the Task-3 deliverable metrics). Polled each tick to
 * chart the failure curve: live fragment count, monotone seq, tombstone pressure.
 */
export interface StreamStats {
  name: string;
  memberCount: number;
  /** Fragments (chunks) currently live in state. */
  liveFragments: number;
  /** Highest frame seq ever allocated (monotone; also == total frames sent). */
  nextSeq: number;
  /** Lowest frame seq still live (frames below this were pruned → tombstones). */
  oldestLiveSeq: number;
  /** How many frames have been pruned (each pruned fragment is a tombstone). */
  prunedFrames: number;
}

// ── Approach 2: opaque chunks from a real browser codec ──────────────────────

/**
 * One WebCodecs-encoded chunk as the WASM app stores and returns it. `dataB64`
 * is an H.264 access unit (annex-B) that only a real decoder understands — the
 * app never interprets it, which is what makes a hardware codec legal here.
 */
export interface ChunkView {
  seq: number;
  from: string;
  track: number;
  isKeyframe: boolean;
  /** Feed this straight into VideoDecoder.configure — it must match the encoder. */
  codec: string;
  width: number;
  height: number;
  timestampUs: number;
  dataB64: string;
  createdAt: number;
}

/** Approach-2 instrumentation snapshot. */
export interface LiveStats {
  liveChunks: number;
  nextChunkSeq: number;
  oldestLiveChunk: number;
  prunedChunks: number;
  lastKeyframeSeq: number;
  /** Summed encoded bytes currently live — the real state footprint. */
  liveBytes: number;
}
