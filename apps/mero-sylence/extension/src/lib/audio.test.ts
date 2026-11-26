import { describe, expect, it } from "vitest";
import { Resampler, TARGET_RATE, downmix, rms } from "./resample";
import { Segmenter } from "./segmenter";

const RATE = TARGET_RATE;

function tone(ms: number, amp = 0.2, freq = 220, rate = RATE): Float32Array {
  const n = Math.round((rate * ms) / 1000);
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
}
function silence(ms: number, noise = 0, rate = RATE): Float32Array {
  const n = Math.round((rate * ms) / 1000);
  // Deterministic "noise": a fixed pseudo-random sequence.
  let x = 12345;
  return Float32Array.from({ length: n }, () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return noise * ((x / 0x7fffffff) * 2 - 1);
  });
}
function cat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
/** Feeds `audio` in uneven blocks, as the worklet does, and collects the stretches. */
function run(seg: Segmenter, audio: Float32Array, block = 1_365) {
  const out = [];
  for (let i = 0; i < audio.length; i += block) out.push(...seg.push(audio.slice(i, i + block)));
  return out;
}

describe("resampler", () => {
  it("turns 48 kHz into 16 kHz across block seams", () => {
    const r = new Resampler(48_000);
    const input = tone(1_000, 0.5, 440, 48_000);
    let total = 0;
    const pieces: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 4096) {
      const out = r.push(input.slice(i, i + 4096));
      pieces.push(out);
      total += out.length;
    }
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(2);
    // The tone survives: 440 Hz is ~880 zero crossings a second.
    const all = cat(...pieces);
    let crossings = 0;
    for (let i = 1; i < all.length; i++) if (((all[i - 1] as number) < 0) !== ((all[i] as number) < 0)) crossings++;
    expect(crossings).toBeGreaterThan(860);
    expect(crossings).toBeLessThan(900);
  });

  it("passes 16 kHz through and handles 44.1 kHz", () => {
    expect(new Resampler(16_000).push(tone(100))).toHaveLength(1_600);
    const r = new Resampler(44_100);
    let n = 0;
    for (let i = 0; i < 10; i++) n += r.push(new Float32Array(4_410)).length;
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(2);
    expect(() => new Resampler(0)).toThrow();
  });

  it("mixes channels and measures level", () => {
    expect(Array.from(downmix([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5]);
    expect(downmix([])).toHaveLength(0);
    expect(rms(Float32Array.of(0.5, -0.5))).toBeCloseTo(0.5);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe("segmenter", () => {
  it("keeps one stretch of speech between silences, with its times", () => {
    const seg = new Segmenter();
    const chunks = run(seg, cat(silence(1_000), tone(2_000), silence(2_000)));
    expect(chunks).toHaveLength(1);
    const [c] = chunks;
    // Starts a little before the speech (pre-roll), ends a little after.
    expect(c!.startMs).toBeGreaterThanOrEqual(700);
    expect(c!.startMs).toBeLessThanOrEqual(1_000);
    expect(c!.endMs).toBeGreaterThanOrEqual(3_000);
    expect(c!.endMs).toBeLessThanOrEqual(3_300);
    expect(c!.audio.length).toBe(Math.round(((c!.endMs - c!.startMs) / 1000) * RATE));
  });

  it("drops silence, steady noise and a click", () => {
    const seg = new Segmenter();
    expect(run(seg, silence(3_000))).toHaveLength(0);
    expect(run(seg, silence(5_000, 0.004))).toHaveLength(0);
    expect(run(seg, cat(tone(120), silence(3_000)))).toHaveLength(0);
    expect(seg.flush()).toHaveLength(0);
  });

  it("learns a noisy room's floor, then still hears speech above it", () => {
    const seg = new Segmenter();
    const noisy = silence(4_000, 0.02);
    expect(run(seg, noisy)).toHaveLength(0);
    expect(seg.threshold).toBeGreaterThan(0.008);
    const chunks = run(seg, cat(tone(1_500, 0.3), silence(2_500, 0.02)));
    expect(chunks).toHaveLength(1);
  });

  it("hears someone already talking when recording starts", () => {
    const seg = new Segmenter();
    const chunks = [...run(seg, cat(tone(3_000), silence(3_000)))];
    expect(chunks).toHaveLength(1);
    // The first 0.6 s measure the room; the speech after it is kept.
    expect(chunks[0]!.startMs).toBeLessThanOrEqual(600);
  });

  it("cuts long speech at the maximum length", () => {
    const seg = new Segmenter({ maxMs: 5_000 });
    const chunks = [...run(seg, cat(silence(1_000), tone(12_000))), ...seg.flush()];
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.endMs - c.startMs).toBeLessThanOrEqual(5_000);
    expect(chunks[1]!.startMs).toBe(chunks[0]!.endMs);
  });

  it("joins a short phrase with the next across a brief pause", () => {
    const seg = new Segmenter();
    const chunks = run(seg, cat(silence(1_000), tone(500), silence(800), tone(600), silence(3_000)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.endMs - chunks[0]!.startMs).toBeGreaterThan(1_800);
  });

  it("flushes the stretch still open when recording stops, offset into the meeting", () => {
    const seg = new Segmenter({ offsetMs: 10_000 });
    expect(run(seg, cat(silence(500), tone(1_500)))).toHaveLength(0);
    expect(seg.speaking).toBe(true);
    const [c] = seg.flush();
    expect(c!.startMs).toBeGreaterThanOrEqual(10_200);
    expect(c!.endMs).toBeGreaterThanOrEqual(11_900);
    expect(seg.speaking).toBe(false);
  });
});
