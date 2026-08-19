// ── Approach 1: carry the media on EPHEMERAL PRESENCE, not on replicated state ─
//
// core 0.11.0-rc.24 shipped ephemeral presence (core#3427): a per-author,
// in-memory, signed, group-key-encrypted slice that gossips between nodes
// WITHOUT a WASM run, without a state delta, and without ever touching the DAG.
// The node sweeps it on a 7 s TTL and re-publishes the holder's own slice every
// 2.5 s.
//
// That is a strictly better shape for live media than approach 2's `post_chunk`,
// and for three separate reasons:
//
//   1. NO DAG GROWTH. `post_chunk` writes every access unit into replicated
//      state — ~188 KB/s of new state at 1.5 Mbps — and then needs
//      `prune_chunks` to walk it back, which writes *more* deltas (tombstones)
//      to undo the first set. Presence writes nothing, so there is nothing to
//      reap. core's own e2e asserts `contextStateHash` is byte-identical across
//      a `set_ephemeral`, and that guard is the load-bearing one.
//   2. NO SECOND ROUND-TRIP ON RECEIVE. `post_chunk` only notifies
//      (`ChunkPosted`); the receiver then has to call `get_chunks(cursors)` to
//      learn what was posted. An `Ephemeral` event CARRIES the bytes, so the
//      frame arrives with the notification.
//   3. NO WASM EXECUTION per frame. Presence never enters the runtime.
//
// What it costs, and this module exists to pay it:
//
//   * A slice is capped at 16 KiB, so anything larger has to be FRAGMENTED.
//   * A slice is a single-writer REGISTER, not a queue: each publish replaces
//     the author's previous one, LWW by a node-assigned per-author seq. Every
//     publish still emits its own delta event, so the channel behaves like a
//     lossy 16 KiB datagram pipe — but an envelope that arrives after a
//     higher-seq one is dropped by the node with no event at all.
//   * The node suppresses a diff when the new slice's BYTES are unchanged
//     ("same bytes, higher seq → liveness updated, no diff" in
//     `AwarenessStore::apply`). Two byte-identical frames in a row would make
//     the second invisible.
//
// The framing below answers all three: a fixed header carries a per-sender
// `msgSeq` plus `fragIndex`/`fragCount`, so a receiver can reassemble, discard
// an incomplete frame instead of feeding a decoder half a picture, ignore a
// replay, and — because `msgSeq` advances every frame — never emit two
// byte-identical slices in a row.
//
// Everything here is pure and framework-free, which is the point: the
// interesting failure modes (a lost fragment, a reordered fragment, a foreign
// slice from some other feature sharing the same presence channel) are all
// reachable in a unit test, with no node and no camera. See
// ephemeralFrames.test.ts.

/**
 * Maximum bytes in one presence slice.
 *
 * MIRRORS `EPHEMERAL_MAX_BYTES` in calimero-primitives (`crates/primitives/
 * src/events.rs`), which is the single source of truth shared by the node's
 * outbound enforcement and the JSON-RPC pre-validation. Exceeding it is a typed
 * `SliceTooLarge` RPC rejection, not a silent truncation — so this constant
 * only decides how we fragment, never whether the node is protected.
 */
export const EPHEMERAL_MAX_BYTES = 16_384;

/** `"MS"` — Mero Stream. Guards against decoding a slice we did not write. */
const MAGIC_0 = 0x4d;
const MAGIC_1 = 0x53;

/** Bump on any header change. A receiver drops a version it does not know. */
export const FRAME_VERSION = 1;

/** Bytes before the variable-length codec string. See the layout below. */
const HEADER_FIXED_BYTES = 32;

// Header layout, little-endian throughout:
//
//   off  size  field
//   0    2     magic "MS"
//   2    1     version
//   3    1     track          (0 = video, 1 = audio — same convention as
//                              MediaChunk::track in logic/src/lib.rs)
//   4    1     flags          bit0 = keyframe
//   5    4     msgSeq         u32, per-sender, monotone, one per FRAME
//   9    1     fragIndex      u8
//   10   1     fragCount      u8
//   11   2     width          u16
//   13   2     height         u16
//   15   8     timestampUs    u64 — the media clock the decoder needs
//   23   8     createdAtMs    u64 — sender wall clock, for the §4 latency probe
//   31   1     codecLen       u8
//   32   …     codec          ASCII
//   …    …     payload
//
// The codec string rides in EVERY fragment rather than only in fragment 0. It
// costs ~11 bytes against a 16 KiB budget, and it makes each fragment
// self-describing: reassembly then does not depend on which fragment happens to
// arrive first, which matters precisely because this channel reorders.

const FLAG_KEYFRAME = 0x01;

/** Highest `fragCount` the 1-byte field can express. */
export const MAX_FRAGMENTS = 255;

/** Largest `msgSeq` the 4-byte field can express. */
const MSG_SEQ_MODULUS = 0x1_0000_0000;

/** One encoded frame, as the send side hands it over and the receive side gets it back. */
export interface LiveFrame {
  /** Per-sender frame counter. Monotone; see `nextMsgSeq`. */
  msgSeq: number;
  /** 0 = video, 1 = audio. */
  track: number;
  isKeyframe: boolean;
  width: number;
  height: number;
  /** WebCodecs presentation timestamp, microseconds. */
  timestampUs: number;
  /** Sender wall clock, unix MILLISECONDS (same unit as `MediaChunk::created_at`). */
  createdAtMs: number;
  /** The exact codec string the peer's decoder must be configured with. */
  codec: string;
  /** The encoded access unit. Opaque — this module never parses it. */
  bytes: Uint8Array;
}

/** A decoded fragment header plus its slice of the frame's bytes. */
export interface FrameFragment {
  msgSeq: number;
  track: number;
  isKeyframe: boolean;
  width: number;
  height: number;
  timestampUs: number;
  createdAtMs: number;
  codec: string;
  fragIndex: number;
  fragCount: number;
  payload: Uint8Array;
}

/**
 * How many payload bytes fit in one fragment for a given codec string.
 *
 * A function of the codec because the codec rides in the header (see above), so
 * a longer codec string buys fewer payload bytes. Never negative: a codec long
 * enough to fill the slice on its own is rejected by `encodeFragments`.
 */
export function maxPayloadBytes(codec: string): number {
  return EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - codecBytes(codec).length;
}

/**
 * ASCII bytes of a codec string.
 *
 * ASCII, not UTF-8, deliberately: `codecLen` is one byte and WebCodecs codec
 * strings are ASCII by specification (`avc1.42001f`, `opus`, `vp8`). Encoding a
 * non-ASCII string here would make `codecLen` disagree with the character count
 * on the way back out, so a non-ASCII codec is rejected rather than mangled.
 */
function codecBytes(codec: string): Uint8Array {
  const out = new Uint8Array(codec.length);
  for (let i = 0; i < codec.length; i++) {
    const code = codec.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(`codec string must be ASCII: ${JSON.stringify(codec)}`);
    }
    out[i] = code;
  }
  return out;
}

/**
 * Split one frame into presence-sized fragments, each ready to hand to
 * `set_ephemeral`.
 *
 * A zero-byte frame still produces ONE fragment. That is not a degenerate case
 * to optimize away: dropping it would publish nothing, the receiver would see no
 * event, and `msgSeq` would skip — which the probe reads as a lost frame.
 */
export function encodeFragments(frame: LiveFrame): Uint8Array[] {
  const codec = codecBytes(frame.codec);
  const capacity = EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - codec.length;
  if (capacity <= 0) {
    throw new Error(
      `codec string leaves no room for payload: ${frame.codec.length} bytes`,
    );
  }

  const fragCount = Math.max(1, Math.ceil(frame.bytes.length / capacity));
  if (fragCount > MAX_FRAGMENTS) {
    throw new Error(
      `frame of ${frame.bytes.length} bytes needs ${fragCount} fragments (max ${MAX_FRAGMENTS})`,
    );
  }

  const out: Uint8Array[] = [];
  for (let i = 0; i < fragCount; i++) {
    const payload = frame.bytes.subarray(i * capacity, (i + 1) * capacity);
    const buf = new Uint8Array(
      HEADER_FIXED_BYTES + codec.length + payload.length,
    );
    const view = new DataView(buf.buffer);

    buf[0] = MAGIC_0;
    buf[1] = MAGIC_1;
    buf[2] = FRAME_VERSION;
    buf[3] = frame.track & 0xff;
    buf[4] = frame.isKeyframe ? FLAG_KEYFRAME : 0;
    view.setUint32(5, frame.msgSeq % MSG_SEQ_MODULUS, true);
    buf[9] = i;
    buf[10] = fragCount;
    view.setUint16(11, frame.width & 0xffff, true);
    view.setUint16(13, frame.height & 0xffff, true);
    // Rounded, not truncated: WebCodecs hands out fractional microseconds
    // (`performance.now() * 1000`) and BigInt conversion of a non-integer
    // throws. The contract path rounds at the same boundary.
    view.setBigUint64(
      15,
      BigInt(Math.max(0, Math.round(frame.timestampUs))),
      true,
    );
    view.setBigUint64(
      23,
      BigInt(Math.max(0, Math.round(frame.createdAtMs))),
      true,
    );
    buf[31] = codec.length;
    buf.set(codec, HEADER_FIXED_BYTES);
    buf.set(payload, HEADER_FIXED_BYTES + codec.length);

    out.push(buf);
  }
  return out;
}

/**
 * Parse one presence slice back into a fragment, or `null` if it is not ours.
 *
 * Returning `null` rather than throwing is load-bearing. Presence is ONE
 * channel per context shared by whatever else the app (or a future feature)
 * publishes there — a cursor position, a typing flag — and every such slice is
 * delivered to this subscriber too. A foreign or truncated slice must be a
 * silent no-op on the receive path, not an exception that tears down the decode
 * loop.
 */
export function decodeFragment(slice: Uint8Array): FrameFragment | null {
  if (slice.length < HEADER_FIXED_BYTES) return null;
  if (slice[0] !== MAGIC_0 || slice[1] !== MAGIC_1) return null;
  if (slice[2] !== FRAME_VERSION) return null;

  const codecLen = slice[31];
  const payloadStart = HEADER_FIXED_BYTES + codecLen;
  if (slice.length < payloadStart) return null;

  const fragCount = slice[10];
  const fragIndex = slice[9];
  // A zero fragCount, or an index outside it, cannot be reassembled into
  // anything — treat it as foreign rather than buffering a fragment that can
  // never complete.
  if (fragCount === 0 || fragIndex >= fragCount) return null;

  const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  let codec = "";
  for (let i = 0; i < codecLen; i++) {
    codec += String.fromCharCode(slice[HEADER_FIXED_BYTES + i]);
  }

  return {
    msgSeq: view.getUint32(5, true),
    track: slice[3],
    isKeyframe: (slice[4] & FLAG_KEYFRAME) !== 0,
    width: view.getUint16(11, true),
    height: view.getUint16(13, true),
    timestampUs: Number(view.getBigUint64(15, true)),
    createdAtMs: Number(view.getBigUint64(23, true)),
    codec,
    fragIndex,
    fragCount,
    // A copy, not a view: the caller retains this across events while the
    // source array is the one-shot decode of a single slice.
    payload: slice.slice(payloadStart),
  };
}

/**
 * How many partially-received frames to hold per sender before dropping the
 * oldest.
 *
 * Small on purpose. A frame whose fragments have not all arrived within the
 * next few frames is not going to be useful: this is real-time media, and the
 * decoder wants the newest decodable picture, not the completion of a stale
 * one. Holding more would only buy memory growth on a lossy link, which is the
 * exact case the bound exists for.
 */
export const MAX_PENDING_FRAMES = 4;

interface Pending {
  fragments: (Uint8Array | null)[];
  received: number;
  header: FrameFragment;
}

/**
 * Reassembles fragments into frames, per sender.
 *
 * Every rule here exists because of a specific property of the presence
 * channel, not as generic defensiveness:
 *
 * * **Out-of-order fragments.** The node bumps a per-author seq per publish and
 *   drops anything below the highest it has applied, and the outbound publish
 *   itself is spawned asynchronously — so consecutive `set_ephemeral` calls can
 *   reach a peer out of order, and the loser is dropped with no event. Buffering
 *   by `msgSeq` + `fragIndex` (instead of assuming arrival order) is what makes
 *   the reordered-but-complete case still produce a frame.
 * * **Lost fragments.** A multi-fragment frame missing one fragment is NEVER
 *   emitted. Feeding a decoder a truncated access unit is worse than dropping
 *   the frame: it throws, which closes the `VideoDecoder` and (before the
 *   self-heal in useLiveStream) froze that peer's tile permanently.
 * * **Replays.** A `msgSeq` at or below the last one emitted is ignored, so a
 *   re-delivered slice cannot push an old picture into a decoder that has
 *   already moved past it.
 */
export class FrameReassembler {
  private readonly pending = new Map<string, Map<number, Pending>>();
  private readonly lastEmitted = new Map<string, number>();

  /**
   * Feed one fragment. Returns the completed frame, or `null` if this fragment
   * did not complete one (or belongs to a frame already emitted).
   */
  push(author: string, fragment: FrameFragment): LiveFrame | null {
    const emitted = this.lastEmitted.get(author);
    if (emitted !== undefined && fragment.msgSeq <= emitted) return null;

    // The single-fragment case never enters the buffer. It is the common case by
    // a wide margin — a delta frame at 1.5 Mbps / 25 fps is ~7.5 KB against a
    // ~16.3 KB fragment — so keeping it allocation-free also keeps the hot path
    // honest about where the cost is.
    if (fragment.fragCount === 1) {
      this.lastEmitted.set(author, fragment.msgSeq);
      this.dropUpTo(author, fragment.msgSeq);
      return toFrame(fragment, fragment.payload);
    }

    let byAuthor = this.pending.get(author);
    if (!byAuthor) {
      byAuthor = new Map();
      this.pending.set(author, byAuthor);
    }

    let slot = byAuthor.get(fragment.msgSeq);
    if (!slot) {
      slot = {
        fragments: new Array<Uint8Array | null>(fragment.fragCount).fill(null),
        received: 0,
        header: fragment,
      };
      byAuthor.set(fragment.msgSeq, slot);
      // Evict the OLDEST incomplete frame, not the newest: the newest is the one
      // still plausibly completing.
      while (byAuthor.size > MAX_PENDING_FRAMES) {
        const oldest = Math.min(...byAuthor.keys());
        byAuthor.delete(oldest);
      }
    }

    // A `fragCount` that disagrees with the slot we already opened means two
    // different framings claim one `msgSeq`. Drop the whole slot rather than
    // splicing them: a frame built from two framings is garbage that would only
    // fail later, inside the decoder.
    if (slot.fragments.length !== fragment.fragCount) {
      byAuthor.delete(fragment.msgSeq);
      return null;
    }
    // Idempotent: a duplicated fragment must not double-count `received` and
    // complete a frame that still has a hole in it.
    if (slot.fragments[fragment.fragIndex] !== null) return null;

    slot.fragments[fragment.fragIndex] = fragment.payload;
    slot.received += 1;
    if (slot.received < slot.fragments.length) return null;

    byAuthor.delete(fragment.msgSeq);
    this.lastEmitted.set(author, fragment.msgSeq);
    this.dropUpTo(author, fragment.msgSeq);

    return toFrame(slot.header, concat(slot.fragments as Uint8Array[]));
  }

  /**
   * Forget partial frames at or below `msgSeq`.
   *
   * Once a frame has been emitted, the replay gate in `push` refuses everything
   * at or below it — so a partial frame down there can never complete, and
   * holding it only spends the pending bound on entries that are already dead.
   * Called from BOTH completion paths: the single-fragment one is the common
   * case (a delta frame is ~7.5 KB against a ~16.3 KB fragment), so skipping it
   * there would leave the abandoned tail of a keyframe sitting in the buffer
   * until the size bound happened to evict it.
   */
  private dropUpTo(author: string, msgSeq: number): void {
    const byAuthor = this.pending.get(author);
    if (!byAuthor) return;
    for (const seq of [...byAuthor.keys()]) {
      if (seq <= msgSeq) byAuthor.delete(seq);
    }
  }

  /** Drop everything held for a sender that has gone away. */
  forget(author: string): void {
    this.pending.delete(author);
    this.lastEmitted.delete(author);
  }

  /** Partially-received frames currently held for a sender (diagnostics/tests). */
  pendingCount(author: string): number {
    return this.pending.get(author)?.size ?? 0;
  }
}

function toFrame(header: FrameFragment, bytes: Uint8Array): LiveFrame {
  return {
    msgSeq: header.msgSeq,
    track: header.track,
    isKeyframe: header.isKeyframe,
    width: header.width,
    height: header.height,
    timestampUs: header.timestampUs,
    createdAtMs: header.createdAtMs,
    codec: header.codec,
    bytes,
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Per-sender frame counter, wrapping at the header's 4-byte field.
 *
 * Wrap is unreachable in practice — 2^32 frames is ~5.5 years at 25 fps — but
 * the arithmetic is stated rather than assumed, because the receive side's
 * replay gate is a plain `<=` comparison and would stall for good on a counter
 * that silently exceeded the field it is written into.
 */
export function nextMsgSeq(current: number): number {
  return (current + 1) % MSG_SEQ_MODULUS;
}

/**
 * Codec for mero-js's ephemeral client: raw bytes, no JSON.
 *
 * The wire carries `state` as a JSON array of byte values, which mero-js's
 * default `jsonCodec` reaches by JSON-stringifying the value and then
 * byte-encoding THAT — two encodings for something that is already bytes, and
 * ~2x the wire for base64-ish text on top. The node never deserializes a slice
 * (it is encrypted under the group key and travels client-to-client), so the
 * encoding is ours to choose.
 */
export const bytesCodec = {
  encode(value: Uint8Array): number[] {
    return Array.from(value);
  },
  decode(bytes: number[]): Uint8Array {
    return new Uint8Array(bytes);
  },
};
