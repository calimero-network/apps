import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, webCodecsAvailable } from "./webcodecs";

// The encoder/decoder wrappers need real WebCodecs and a real camera, so they
// cannot be tested here — jsdom has neither. What IS testable is the base64
// transport, and it is worth testing precisely because it carries every byte of
// video: a bug here corrupts the bitstream and surfaces as a *decoder* error,
// which is the last place anyone would look.

describe("base64 transport", () => {
  it("round-trips arbitrary binary, including bytes no text encoding survives", () => {
    // Encoded H.264 is arbitrary binary: nulls, 0xFF, and the 0x00 00 01 start
    // codes annex-B is built from. Anything that treats this as text corrupts it.
    const bytes = new Uint8Array([
      0, 0, 0, 1, 0x67, 0xff, 0xfe, 0x80, 0x7f, 0x00,
    ]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("round-trips every possible byte value", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect([...base64ToBytes(bytesToBase64(all))]).toEqual([...all]);
  });

  it("handles an empty buffer without throwing", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(base64ToBytes("").length).toBe(0);
  });

  it("survives a keyframe-sized payload past the chunking boundary", () => {
    // bytesToBase64 batches through String.fromCharCode in 0x8000 slices because
    // spreading ~60k args throws in some engines. That failure would only ever
    // appear on keyframes — i.e. intermittently, mid-stream — so the boundary is
    // exercised deliberately here.
    const size = 0x8000 * 2 + 1234; // spans three batches
    const big = new Uint8Array(size);
    for (let i = 0; i < size; i++) big[i] = (i * 37) % 256;
    const round = base64ToBytes(bytesToBase64(big));
    expect(round.length).toBe(size);
    // Spot-check the batch seams, where a slicing bug would land.
    for (const i of [0, 0x7fff, 0x8000, 0x8001, 0xffff, 0x10000, size - 1]) {
      expect(round[i]).toBe(big[i]);
    }
  });

  it("expands by ~1.37x, the reason we do not send a JSON number array", () => {
    // A raw Vec<u8> over JSON-RPC serializes as "[0,17,34,...]" — roughly 3 bytes
    // of text per byte of payload. Base64 is 4/3. That is the difference between
    // ~30 KB and ~80 KB of JSON for one 22 KB keyframe.
    const payload = new Uint8Array(3000);
    const ratio = bytesToBase64(payload).length / payload.length;
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.4);
  });

  it("produces standard padded base64 the Rust STANDARD engine accepts", () => {
    // The app decodes with base64::engine::general_purpose::STANDARD, which is
    // padded and uses +/ — not the URL-safe alphabet. A mismatch would be a
    // decode error on every single chunk.
    expect(bytesToBase64(new Uint8Array([1]))).toMatch(
      /^[A-Za-z0-9+/]+={0,2}$/,
    );
    expect(bytesToBase64(new Uint8Array([1])).length % 4).toBe(0);
    expect(bytesToBase64(new Uint8Array([255, 255]))).toMatch(/=$/);
  });
});

describe("webCodecsAvailable", () => {
  it("reports false under jsdom, which has no VideoEncoder", () => {
    // Also the guard that turns "constructor threw" into an actionable
    // "run this in Chrome" message on the page.
    expect(webCodecsAvailable()).toBe(false);
  });
});
