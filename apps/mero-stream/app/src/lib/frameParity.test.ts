import { describe, expect, it } from "vitest";
import {
  EPHEMERAL_MAX_BYTES as TS_MAX,
  FRAME_VERSION as TS_VERSION,
  decodeFragment,
  encodeFragments as tsEncode,
  maxPayloadBytes as tsMaxPayload,
  type LiveFrame,
} from "./ephemeralFrames";
import {
  EPHEMERAL_MAX_BYTES as JS_MAX,
  FRAME_VERSION as JS_VERSION,
  HEADER_FIXED_BYTES as JS_HEADER,
  decodeHeader as jsDecode,
  encodeFragments as jsEncode,
  maxPayloadBytes as jsMaxPayload,
} from "../../e2e/lib/frame.mjs";

/**
 * ── Two implementations of one wire format, held to each other ────────────────
 *
 * `src/lib/ephemeralFrames.ts` is the source of truth and the app uses it. The
 * merobox e2e drivers cannot: they are plain `.mjs` run straight by `node` with
 * no build step, so they use `e2e/lib/frame.mjs` instead.
 *
 * That duplication is unavoidable. Silent drift between the two is not, and the
 * cost of drift is high and quiet: a driver encoding v1 offsets publishes bytes
 * the app discards as foreign, which surfaces as "presence delivered nothing"
 * rather than as "the test encodes the wrong layout". Header v2 was exactly such
 * a change — it moved `codecLen` from offset 31 to 39.
 *
 * So this test encodes the same frames through both and compares BYTES. It is the
 * reason the second implementation is safe to have, and it replaced a third copy
 * that was hand-retyped in each driver.
 */

const CODEC = "avc1.42001f";

function frame(over: Partial<LiveFrame> = {}): LiveFrame {
  return {
    msgSeq: 7,
    track: 0,
    isKeyframe: false,
    width: 640,
    height: 480,
    timestampUs: 1_234_567,
    createdAtMs: 1_700_000_000_123,
    startedAtMs: 1_700_000_000_000,
    codec: CODEC,
    bytes: new Uint8Array(1000).map((_, i) => (i * 31 + 11) & 0xff),
    ...over,
  };
}

const hex = (a: Uint8Array) =>
  [...a].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("wire-format parity: ephemeralFrames.ts vs e2e/lib/frame.mjs", () => {
  it("agrees on the constants that define the layout", () => {
    expect(JS_VERSION).toBe(TS_VERSION);
    expect(JS_MAX).toBe(TS_MAX);
    // 40 in v2; asserted directly so a change has to be deliberate in both.
    expect(JS_HEADER).toBe(40);
    expect(jsMaxPayload(CODEC)).toBe(tsMaxPayload(CODEC));
  });

  it.each([
    ["a single-fragment delta", frame()],
    ["a keyframe", frame({ isKeyframe: true })],
    ["an empty frame", frame({ bytes: new Uint8Array(0) })],
    [
      "a multi-fragment frame",
      frame({ bytes: new Uint8Array(50_000).map((_, i) => i & 0xff) }),
    ],
    ["audio on track 1", frame({ track: 1 })],
    [
      "fractional microseconds",
      frame({ timestampUs: 1234.7, createdAtMs: 99.2 }),
    ],
    ["a wrapped msgSeq", frame({ msgSeq: 0xffffffff })],
    ["a short codec", frame({ codec: "vp8" })],
    ["a large geometry", frame({ width: 1280, height: 720 })],
    ["a zero startedAtMs", frame({ startedAtMs: 0 })],
  ])("produces byte-identical fragments for %s", (_label, f) => {
    const ts = tsEncode(f);
    const js = jsEncode(f);
    expect(js).toHaveLength(ts.length);
    for (let i = 0; i < ts.length; i++) {
      // Compared as hex so a mismatch reports WHERE, not just "arrays differ".
      expect(hex(js[i]), `fragment ${i} differs`).toBe(hex(ts[i]));
    }
  });

  it("each implementation decodes the other's output", () => {
    const f = frame({ isKeyframe: true, msgSeq: 4242 });

    // js encode -> ts decode
    const fromJs = decodeFragment(jsEncode(f)[0]);
    expect(fromJs).not.toBeNull();
    expect(fromJs!.msgSeq).toBe(4242);
    expect(fromJs!.isKeyframe).toBe(true);
    expect(fromJs!.startedAtMs).toBe(f.startedAtMs);
    expect(fromJs!.codec).toBe(CODEC);

    // ts encode -> js decode
    const fromTs = jsDecode(tsEncode(f)[0]);
    expect(fromTs).not.toBeNull();
    expect(fromTs!.msgSeq).toBe(4242);
    expect(fromTs!.isKeyframe).toBe(true);
    expect(fromTs!.startedAtMs).toBe(f.startedAtMs);
    expect(fromTs!.codec).toBe(CODEC);
  });

  it("the .mjs decoder reads a HEADER-ONLY prefix", () => {
    // The capacity ladder deliberately never materialises the payload — it
    // regex-extracts the first ~60 state bytes — so `decodeHeader` has to work on
    // a truncated slice. If it required the full body, the ladder would report
    // zero delivered frames while everything worked.
    const full = tsEncode(frame({ bytes: new Uint8Array(9000) }))[0];
    const prefix = full.slice(0, 60);
    const h = jsDecode(prefix);
    expect(h).not.toBeNull();
    expect(h!.fragCount).toBeGreaterThan(0);
    expect(h!.startedAtMs).toBe(1_700_000_000_000);
  });

  it("both reject a foreign slice rather than throwing", () => {
    // Presence is one channel per context, shared with anything else publishing
    // there, so every such slice reaches this code too.
    const foreign = new Uint8Array(64).fill(0x41);
    expect(jsDecode(foreign)).toBeNull();
    expect(decodeFragment(foreign)).toBeNull();
  });

  it("both reject the PREVIOUS header version", () => {
    // The exact drift this test exists for: a v1 slice must be discarded, not
    // read with v2 offsets.
    const v1 = tsEncode(frame())[0].slice();
    v1[2] = 1;
    expect(jsDecode(v1)).toBeNull();
    expect(decodeFragment(v1)).toBeNull();
  });
});
