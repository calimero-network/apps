// ── The ephemeral media frame format, for the e2e drivers ─────────────────────
//
// The SAME wire format as `app/src/lib/ephemeralFrames.ts`, which is the source
// of truth. This exists because that module is TypeScript and the merobox drivers
// are plain `.mjs` run by `node` with no build step, so they cannot import it.
//
// Two copies is one too many already; there were THREE — this layout was hand-
// retyped in `ephemeral-frames.mjs` and again in `capacity-ladder.mjs`. Every
// header change then had to be applied by hand in three places with nothing
// checking them against each other, and header v2 (`startedAtMs`) was exactly
// such a change: it moved `codecLen` from offset 31 to 39, and a driver that
// missed it would publish bytes the app decodes as garbage or silently discards
// as foreign.
//
// The remaining duplication is guarded rather than tolerated:
// `src/lib/framePariy.test.ts` encodes the same frame through BOTH this module
// and the TypeScript one and asserts the bytes are identical, so drift fails a
// unit test instead of a six-minute CI job.
//
// Keep this file dependency-free and plain ES: it is imported by node directly.

/** Mirrors EPHEMERAL_MAX_BYTES in calimero-primitives. */
export const EPHEMERAL_MAX_BYTES = 16_384;

/** Bump in lockstep with FRAME_VERSION in src/lib/ephemeralFrames.ts. */
export const FRAME_VERSION = 2;

/** Bytes before the variable-length codec string. v2 = 40 (v1 was 32). */
export const HEADER_FIXED_BYTES = 40;

const MAGIC_0 = 0x4d; // "M"
const MAGIC_1 = 0x53; // "S"
const FLAG_KEYFRAME = 0x01;

/** Payload bytes available in one slice for a given codec string. */
export function maxPayloadBytes(codec) {
  return EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - codec.length;
}

/**
 * Split one frame into presence-sized fragments.
 *
 * Field-for-field identical to the TypeScript `encodeFragments`, including the
 * detail that a ZERO-BYTE frame still produces one fragment: dropping it would
 * publish nothing, emit no event, and skip a `msgSeq`, which a receiver reads as
 * a lost frame.
 */
export function encodeFragments({
  msgSeq,
  track = 0,
  isKeyframe,
  width,
  height,
  timestampUs,
  createdAtMs,
  startedAtMs,
  codec,
  bytes,
}) {
  const codecBytes = new Uint8Array([...codec].map((c) => c.charCodeAt(0)));
  const capacity = EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - codecBytes.length;
  if (capacity <= 0) {
    throw new Error(`codec string leaves no room for payload: ${codec.length}`);
  }

  const fragCount = Math.max(1, Math.ceil(bytes.length / capacity));
  const out = [];
  for (let i = 0; i < fragCount; i++) {
    const payload = bytes.subarray(i * capacity, (i + 1) * capacity);
    const buf = new Uint8Array(
      HEADER_FIXED_BYTES + codecBytes.length + payload.length,
    );
    const view = new DataView(buf.buffer);

    buf[0] = MAGIC_0;
    buf[1] = MAGIC_1;
    buf[2] = FRAME_VERSION;
    buf[3] = track & 0xff;
    buf[4] = isKeyframe ? FLAG_KEYFRAME : 0;
    view.setUint32(5, msgSeq % 0x1_0000_0000, true);
    buf[9] = i;
    buf[10] = fragCount;
    view.setUint16(11, width & 0xffff, true);
    view.setUint16(13, height & 0xffff, true);
    // Rounded, not truncated: BigInt() throws on a non-integer, and WebCodecs
    // hands out fractional microseconds.
    view.setBigUint64(15, BigInt(Math.max(0, Math.round(timestampUs))), true);
    view.setBigUint64(23, BigInt(Math.max(0, Math.round(createdAtMs))), true);
    view.setBigUint64(31, BigInt(Math.max(0, Math.round(startedAtMs))), true);
    buf[39] = codecBytes.length;
    buf.set(codecBytes, HEADER_FIXED_BYTES);
    buf.set(payload, HEADER_FIXED_BYTES + codecBytes.length);

    out.push(buf);
  }
  return out;
}

/**
 * Read the header from a slice as it came off the wire, or null if it is not ours.
 *
 * Returns `payloadStart` rather than the payload itself, so a caller holding only
 * a header PREFIX (the capacity ladder deliberately never materialises the body)
 * can use this too.
 */
export function decodeHeader(slice) {
  if (slice.length < HEADER_FIXED_BYTES) return null;
  if (slice[0] !== MAGIC_0 || slice[1] !== MAGIC_1) return null;
  if (slice[2] !== FRAME_VERSION) return null;

  const fragCount = slice[10];
  const fragIndex = slice[9];
  // A zero fragCount, or an index outside it, can never be reassembled — treat
  // it as foreign rather than buffering something that cannot complete.
  if (fragCount === 0 || fragIndex >= fragCount) return null;

  const codecLen = slice[39];
  const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  let codec = "";
  for (let i = 0; i < codecLen && HEADER_FIXED_BYTES + i < slice.length; i++) {
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
    startedAtMs: Number(view.getBigUint64(31, true)),
    codec,
    fragIndex,
    fragCount,
    payloadStart: HEADER_FIXED_BYTES + codecLen,
  };
}
