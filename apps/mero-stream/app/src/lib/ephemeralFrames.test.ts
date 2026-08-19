import { describe, expect, it } from "vitest";
import {
  bytesCodec,
  decodeFragment,
  encodeFragments,
  EPHEMERAL_MAX_BYTES,
  FrameReassembler,
  FRAME_VERSION,
  MAX_FRAGMENTS,
  MAX_PENDING_FRAMES,
  maxPayloadBytes,
  nextMsgSeq,
  type LiveFrame,
} from "./ephemeralFrames";

const CODEC = "avc1.42001f";

/** Deterministic pseudo-random bytes — a real access unit is not compressible. */
function payload(length: number, salt = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + salt * 7 + 11) & 0xff;
  return out;
}

function frame(over: Partial<LiveFrame> = {}): LiveFrame {
  return {
    msgSeq: 1,
    track: 0,
    isKeyframe: false,
    width: 640,
    height: 480,
    timestampUs: 1_234_567,
    createdAtMs: 1_700_000_000_123,
    codec: CODEC,
    bytes: payload(1000),
    ...over,
  };
}

/** Push a frame's fragments through a reassembler in the given order. */
function feed(
  r: FrameReassembler,
  author: string,
  slices: readonly Uint8Array[],
): (LiveFrame | null)[] {
  return slices.map((s) => {
    const f = decodeFragment(s);
    expect(f).not.toBeNull();
    return r.push(author, f!);
  });
}

describe("fragment framing", () => {
  it("round-trips a single-fragment frame with every header field intact", () => {
    const f = frame({
      msgSeq: 42,
      track: 1,
      isKeyframe: true,
      width: 1280,
      height: 720,
      timestampUs: 98_765_432,
      createdAtMs: 1_755_500_000_999,
    });
    const slices = encodeFragments(f);
    expect(slices).toHaveLength(1);

    const got = decodeFragment(slices[0])!;
    expect(got.msgSeq).toBe(42);
    expect(got.track).toBe(1);
    expect(got.isKeyframe).toBe(true);
    expect(got.width).toBe(1280);
    expect(got.height).toBe(720);
    expect(got.timestampUs).toBe(98_765_432);
    expect(got.createdAtMs).toBe(1_755_500_000_999);
    expect(got.fragIndex).toBe(0);
    expect(got.fragCount).toBe(1);
    expect(got.payload).toEqual(f.bytes);
  });

  it("round-trips the codec string VERBATIM — a decoder configured differently produces garbage", () => {
    for (const codec of ["avc1.42001f", "avc1.640028", "opus", "vp8"]) {
      const slices = encodeFragments(frame({ codec, bytes: payload(64) }));
      expect(decodeFragment(slices[0])!.codec).toBe(codec);
    }
  });

  it("keeps every fragment inside the node's 16 KiB slice cap", () => {
    // ~60 KB is a real 480p H.264 keyframe at 1.5 Mbps — the case that forces
    // fragmentation at all.
    const slices = encodeFragments(frame({ bytes: payload(60_000) }));
    expect(slices.length).toBeGreaterThan(1);
    for (const s of slices)
      expect(s.length).toBeLessThanOrEqual(EPHEMERAL_MAX_BYTES);
  });

  it("fills each fragment to capacity, so a frame is never split more than it must be", () => {
    const cap = maxPayloadBytes(CODEC);
    // A frame exactly one byte past capacity is the boundary that an off-by-one
    // in the fragment count would get wrong in the cheapest-to-miss direction.
    const slices = encodeFragments(frame({ bytes: payload(cap + 1) }));
    expect(slices).toHaveLength(2);
    expect(decodeFragment(slices[0])!.payload).toHaveLength(cap);
    expect(decodeFragment(slices[1])!.payload).toHaveLength(1);

    expect(encodeFragments(frame({ bytes: payload(cap) }))).toHaveLength(1);
  });

  it("stamps a fragment exactly at capacity to the full slice cap", () => {
    const slices = encodeFragments(
      frame({ bytes: payload(maxPayloadBytes(CODEC)) }),
    );
    expect(slices[0].length).toBe(EPHEMERAL_MAX_BYTES);
  });

  it("emits ONE fragment for an empty frame rather than none", () => {
    // Publishing nothing would leave a hole in msgSeq that the receive-side gap
    // metric reads as a lost frame.
    const slices = encodeFragments(frame({ bytes: new Uint8Array(0) }));
    expect(slices).toHaveLength(1);
    expect(decodeFragment(slices[0])!.payload).toHaveLength(0);
  });

  it("refuses a frame that would need more fragments than the header can count", () => {
    const tooBig = maxPayloadBytes(CODEC) * (MAX_FRAGMENTS + 1);
    expect(() => encodeFragments(frame({ bytes: payload(tooBig) }))).toThrow(
      /fragments/,
    );
  });

  it("refuses a non-ASCII codec string instead of mangling codecLen", () => {
    expect(() => encodeFragments(frame({ codec: "avc1.42001ƒ" }))).toThrow(
      /ASCII/,
    );
  });

  it("rounds a fractional timestamp rather than throwing on BigInt conversion", () => {
    // WebCodecs hands out `performance.now() * 1000`, which is fractional.
    const slices = encodeFragments(
      frame({ timestampUs: 1234.7, createdAtMs: 99.2 }),
    );
    const got = decodeFragment(slices[0])!;
    expect(got.timestampUs).toBe(1235);
    expect(got.createdAtMs).toBe(99);
  });
});

describe("wire layout", () => {
  // A GOLDEN VECTOR, pinning the exact bytes on the wire.
  //
  // Two independent things encode this header: this module, and the two-node e2e
  // (`app/e2e/ephemeral-frames.mjs`, which hand-rolls the publish side so the CI
  // job needs no TypeScript build). A layout change that only lands on one side
  // would otherwise show up as a mysteriously red e2e; here it fails at the byte
  // that moved, next to the comment naming the other copy.
  it("puts every header field at its documented offset", () => {
    const slice = encodeFragments(
      frame({
        msgSeq: 0x01020304,
        track: 1,
        isKeyframe: true,
        width: 640,
        height: 480,
        timestampUs: 0x0102,
        createdAtMs: 0x0304,
        codec: "vp8",
        bytes: new Uint8Array([0xaa, 0xbb]),
      }),
    )[0];

    expect([...slice]).toEqual([
      0x4d,
      0x53, // 0  magic "MS"
      0x01, // 2  version
      0x01, // 3  track
      0x01, // 4  flags: keyframe
      0x04,
      0x03,
      0x02,
      0x01, // 5  msgSeq u32 LE
      0x00, // 9  fragIndex
      0x01, // 10 fragCount
      0x80,
      0x02, // 11 width  u16 LE (640)
      0xe0,
      0x01, // 13 height u16 LE (480)
      0x02,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // 15 timestampUs u64 LE
      0x04,
      0x03,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // 23 createdAtMs u64 LE
      0x03, // 31 codecLen
      0x76,
      0x70,
      0x38, // 32 "vp8"
      0xaa,
      0xbb, // payload
    ]);
  });

  it("keeps the fixed header at 32 bytes", () => {
    // maxPayloadBytes is stated in terms of it, and the e2e's encoder hard-codes
    // it. Asserted directly so a change cannot pass unnoticed through arithmetic.
    expect(maxPayloadBytes("vp8")).toBe(EPHEMERAL_MAX_BYTES - 32 - 3);
  });
});

describe("decodeFragment rejects anything that is not ours", () => {
  // Presence is ONE channel per context. A cursor slice, a typing flag, or a
  // slice from a future feature is delivered to this subscriber too, and must be
  // a silent no-op — not an exception that tears down the decode loop.
  it("returns null for a foreign slice, never throws", () => {
    expect(
      decodeFragment(new TextEncoder().encode('{"cursor":{"x":1,"y":2}}')),
    ).toBeNull();
  });

  it("returns null for an unknown version", () => {
    const s = encodeFragments(frame())[0];
    s[2] = FRAME_VERSION + 1;
    expect(decodeFragment(s)).toBeNull();
  });

  it("returns null for a slice shorter than the header", () => {
    const s = encodeFragments(frame())[0];
    expect(decodeFragment(s.slice(0, 20))).toBeNull();
    expect(decodeFragment(new Uint8Array(0))).toBeNull();
  });

  it("returns null when the declared codec length runs past the slice", () => {
    const s = encodeFragments(frame({ bytes: new Uint8Array(0) }))[0];
    s[31] = 200;
    expect(decodeFragment(s)).toBeNull();
  });

  it("returns null for a fragment index outside its own fragment count", () => {
    const s = encodeFragments(frame())[0];
    s[9] = 3;
    s[10] = 2;
    expect(decodeFragment(s)).toBeNull();
  });

  it("returns null for a zero fragment count, which can never complete", () => {
    const s = encodeFragments(frame())[0];
    s[10] = 0;
    expect(decodeFragment(s)).toBeNull();
  });
});

describe("FrameReassembler", () => {
  it("emits a single-fragment frame immediately, byte-identical", () => {
    const r = new FrameReassembler();
    const f = frame({ bytes: payload(5000) });
    const [out] = feed(r, "alice", encodeFragments(f));
    expect(out?.bytes).toEqual(f.bytes);
    expect(out?.msgSeq).toBe(f.msgSeq);
  });

  it("reassembles a multi-fragment keyframe byte-identically", () => {
    const r = new FrameReassembler();
    const f = frame({ msgSeq: 7, isKeyframe: true, bytes: payload(60_000) });
    const slices = encodeFragments(f);
    const out = feed(r, "alice", slices);

    // Only the LAST fragment completes the frame.
    expect(out.slice(0, -1).every((x) => x === null)).toBe(true);
    const done = out[out.length - 1]!;
    expect(done.bytes).toEqual(f.bytes);
    expect(done.isKeyframe).toBe(true);
    expect(done.codec).toBe(CODEC);
    expect(r.pendingCount("alice")).toBe(0);
  });

  it("reassembles fragments that arrive OUT OF ORDER", () => {
    // The node's outbound publish is spawned per call, so consecutive
    // set_ephemeral calls can reach a peer in any order.
    const r = new FrameReassembler();
    const f = frame({ bytes: payload(40_000, 3) });
    const slices = encodeFragments(f);
    expect(slices.length).toBe(3);

    const out = feed(r, "alice", [slices[2], slices[0], slices[1]]);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]!.bytes).toEqual(f.bytes);
  });

  it("NEVER emits a frame that is missing a fragment", () => {
    // A truncated access unit makes VideoDecoder throw, which closes it — the
    // failure mode that used to freeze a peer's tile permanently.
    const r = new FrameReassembler();
    const slices = encodeFragments(frame({ bytes: payload(40_000) }));
    const out = feed(r, "alice", [slices[0], slices[2]]);
    expect(out.every((x) => x === null)).toBe(true);
    expect(r.pendingCount("alice")).toBe(1);
  });

  it("ignores a duplicated fragment instead of completing a frame with a hole", () => {
    const r = new FrameReassembler();
    const slices = encodeFragments(frame({ bytes: payload(40_000) }));
    expect(slices.length).toBe(3);
    // fragment 0 twice, then 1 — three pushes, but only two distinct fragments.
    const out = feed(r, "alice", [slices[0], slices[0], slices[1]]);
    expect(out.every((x) => x === null)).toBe(true);
    // …and the frame still completes once the genuinely missing one lands.
    const [done] = feed(r, "alice", [slices[2]]);
    expect(done).not.toBeNull();
  });

  it("ignores a re-delivered frame, so no decoder is fed a picture it passed", () => {
    // The node re-publishes a held slice every 2.5 s. It suppresses the diff
    // when the bytes are unchanged, but a replay reaching a fresh subscriber (or
    // a reconnect) must not rewind this decoder either.
    const r = new FrameReassembler();
    const slices = encodeFragments(frame({ msgSeq: 10 }));
    expect(feed(r, "alice", slices)[0]).not.toBeNull();
    expect(feed(r, "alice", slices)[0]).toBeNull();
  });

  it("ignores a frame older than the newest one already emitted", () => {
    const r = new FrameReassembler();
    expect(
      feed(r, "alice", encodeFragments(frame({ msgSeq: 10 })))[0],
    ).not.toBeNull();
    expect(
      feed(r, "alice", encodeFragments(frame({ msgSeq: 9 })))[0],
    ).toBeNull();
    expect(
      feed(r, "alice", encodeFragments(frame({ msgSeq: 11 })))[0],
    ).not.toBeNull();
  });

  it("drops pending fragments below a frame it has just emitted", () => {
    const r = new FrameReassembler();
    // A partial frame at msgSeq 5 …
    const partial = encodeFragments(
      frame({ msgSeq: 5, bytes: payload(40_000) }),
    );
    feed(r, "alice", [partial[0]]);
    expect(r.pendingCount("alice")).toBe(1);
    // … is dead weight once msgSeq 6 completes, because the replay gate would
    // refuse it even if the rest arrived.
    feed(r, "alice", encodeFragments(frame({ msgSeq: 6 })));
    expect(r.pendingCount("alice")).toBe(0);
  });

  it("bounds the per-sender pending buffer on a lossy link", () => {
    const r = new FrameReassembler();
    for (let seq = 1; seq <= MAX_PENDING_FRAMES + 3; seq++) {
      const slices = encodeFragments(
        frame({ msgSeq: seq, bytes: payload(40_000, seq) }),
      );
      feed(r, "alice", [slices[0]]); // only ever the first fragment
    }
    expect(r.pendingCount("alice")).toBe(MAX_PENDING_FRAMES);
  });

  it("keeps senders independent — each is its own H.264 bitstream", () => {
    const r = new FrameReassembler();
    const a = frame({ msgSeq: 100, bytes: payload(2000, 1) });
    const b = frame({ msgSeq: 3, bytes: payload(2000, 2) });
    expect(feed(r, "alice", encodeFragments(a))[0]!.bytes).toEqual(a.bytes);
    // Bob's much LOWER msgSeq must not be judged against Alice's progress.
    expect(feed(r, "bob", encodeFragments(b))[0]!.bytes).toEqual(b.bytes);
  });

  it("drops a slot whose two claimants disagree on the fragment count", () => {
    const r = new FrameReassembler();
    const three = encodeFragments(frame({ msgSeq: 4, bytes: payload(40_000) }));
    feed(r, "alice", [three[0]]);
    // Same msgSeq, different framing (2 fragments): splicing them would build a
    // frame out of two encodings and only fail later, inside the decoder.
    const two = encodeFragments(frame({ msgSeq: 4, bytes: payload(20_000) }));
    expect(feed(r, "alice", [two[0]])[0]).toBeNull();
    expect(r.pendingCount("alice")).toBe(0);
  });

  it("forget() lets a returning sender start over", () => {
    const r = new FrameReassembler();
    feed(r, "alice", encodeFragments(frame({ msgSeq: 500 })));
    r.forget("alice");
    // Without forget() this msgSeq would be refused as a replay, and a peer who
    // left and came back with a fresh counter would never decode again.
    expect(
      feed(r, "alice", encodeFragments(frame({ msgSeq: 1 })))[0],
    ).not.toBeNull();
  });
});

describe("nextMsgSeq", () => {
  it("advances every frame, so no two consecutive slices are byte-identical", () => {
    // Load-bearing: the node suppresses the delta event when a new slice's bytes
    // match the previous one, so a static picture would go invisible without
    // this counter changing.
    const a = encodeFragments(frame({ msgSeq: 1, bytes: payload(100) }))[0];
    const b = encodeFragments(
      frame({ msgSeq: nextMsgSeq(1), bytes: payload(100) }),
    )[0];
    expect(a).not.toEqual(b);
  });

  it("wraps at the header's 4-byte field rather than overflowing it", () => {
    expect(nextMsgSeq(0xffff_fffe)).toBe(0xffff_ffff);
    expect(nextMsgSeq(0xffff_ffff)).toBe(0);
  });
});

describe("bytesCodec", () => {
  it("round-trips bytes through the wire's number[] form", () => {
    const bytes = payload(256);
    const wire = bytesCodec.encode(bytes);
    expect(Array.isArray(wire)).toBe(true);
    expect(bytesCodec.decode(wire)).toEqual(bytes);
  });

  it("passes 0 and 255 through unchanged", () => {
    const bytes = new Uint8Array([0, 255, 0, 255]);
    expect(bytesCodec.decode(bytesCodec.encode(bytes))).toEqual(bytes);
  });
});
