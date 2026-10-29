// Test vectors for the media framing, produced by the WEB APP'S OWN encoder
// (app/src/lib/ephemeralFrames.ts), so the native ports are checked against
// the bytes a browser actually publishes. Node 22.6+ (type stripping):
//
//   node scripts/gen-frame-vectors.ts
//
// writes the same file to the iOS and Android test fixtures.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFragments, maxPayloadBytes } from "../../app/src/lib/ephemeralFrames.ts";

const here = dirname(fileURLToPath(import.meta.url));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
/** Deterministic filler, mirrored in the native tests: byte i = (i * 31 + seed) & 0xff. */
const pattern = (n: number, seed: number) => {
  const o = new Uint8Array(n);
  for (let i = 0; i < n; i++) o[i] = (i * 31 + seed) & 0xff;
  return o;
};

const frames = [
  { name: "delta-small", frame: { msgSeq: 7, track: 0, isKeyframe: false, width: 640, height: 480, timestampUs: 1234567, createdAtMs: 1761650000123, startedAtMs: 1761649990000, codec: "avc1.42001f", bytes: pattern(24, 3) } },
  { name: "keyframe-portrait", frame: { msgSeq: 4294967295, track: 0, isKeyframe: true, width: 480, height: 640, timestampUs: 0, createdAtMs: 1761650000999, startedAtMs: 1761650000000, codec: "avc1.42c01f", bytes: pattern(5, 200) } },
  { name: "audio-ulaw", frame: { msgSeq: 1, track: 1, isKeyframe: true, width: 0, height: 0, timestampUs: 200000, createdAtMs: 1761650001000, startedAtMs: 1761650000000, codec: "ulaw", bytes: pattern(16, 9) } },
  { name: "empty", frame: { msgSeq: 2, track: 0, isKeyframe: false, width: 640, height: 480, timestampUs: 1, createdAtMs: 2, startedAtMs: 3, codec: "avc1.42001f", bytes: new Uint8Array(0) } },
];

const big = { msgSeq: 9, track: 0, isKeyframe: true, width: 640, height: 480, timestampUs: 5, createdAtMs: 6, startedAtMs: 7, codec: "avc1.42001f", bytes: pattern(40000, 1) };
const bigFragments = encodeFragments(big);

const out = {
  source: "apps/mero-stream/app/src/lib/ephemeralFrames.ts (encodeFragments), via mobile/scripts/gen-frame-vectors.ts",
  maxPayloadAvc: maxPayloadBytes("avc1.42001f"),
  cases: frames.map((c) => ({
    name: c.name,
    frame: { ...c.frame, bytes: hex(c.frame.bytes) },
    fragments: encodeFragments(c.frame).map(hex),
  })),
  multi: {
    frame: { msgSeq: big.msgSeq, track: big.track, isKeyframe: big.isKeyframe, width: big.width, height: big.height, timestampUs: big.timestampUs, createdAtMs: big.createdAtMs, startedAtMs: big.startedAtMs, codec: big.codec, byteLength: big.bytes.length, patternSeed: 1 },
    fragmentLengths: bigFragments.map((f) => f.length),
    headersHex: bigFragments.map((f) => hex(f.subarray(0, 51))),
  },
};

const json = JSON.stringify(out, null, 2) + "\n";
for (const target of [
  "../ios/Core/Tests/StreamCoreTests/Fixtures/frame-vectors.json",
  "../android/app/src/test/resources/frame-vectors.json",
]) {
  writeFileSync(join(here, target), json);
}
console.log(`wrote ${out.cases.length} cases + a ${bigFragments.length}-fragment frame`);
