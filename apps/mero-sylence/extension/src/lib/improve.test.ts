import { describe, expect, it } from "vitest";
import { AudioStore, MAX_KEEP_MS, echoOf, inOrder, linesOf, timedChunks, windowsOf, type Window } from "./improve";

const RATE = 16_000;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

/** `ms` of speech-like audio: bursts whose loudness changes every 60–300 ms. */
function speech(ms: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array((ms * RATE) / 1000);
  let i = 0;
  while (i < out.length) {
    const len = Math.floor((0.06 + r() * 0.24) * RATE);
    const amp = r() < 0.2 ? 0.01 : 0.08 + r() * 0.2;
    for (let j = 0; j < len && i < out.length; j++, i++) out[i] = (r() * 2 - 1) * amp;
  }
  return out;
}
const quiet = (ms: number) => new Float32Array((ms * RATE) / 1000).map((_, i) => ((i * 7919) % 13) / 13 / 2000);

function storeOf(parts: Float32Array[], offsetMs = 0): AudioStore {
  const s = new AudioStore(offsetMs);
  for (const p of parts) for (let i = 0; i < p.length; i += 128) s.push(p.subarray(i, i + 128));
  return s;
}

describe("audio store", () => {
  it("keeps the recording as 16-bit samples and reads any part back", () => {
    const a = speech(25_000, 1);
    const s = storeOf([a]);
    expect(s.length).toBe(a.length);
    expect(s.seconds).toBeCloseTo(25);
    const back = s.read(RATE * 12, RATE * 12 + 500);
    for (let i = 0; i < back.length; i++) expect(back[i]!).toBeCloseTo(a[RATE * 12 + i]!, 3);
  });

  it("stops keeping past the limit and says so", () => {
    const s = new AudioStore();
    const hour = new Float32Array(RATE * 60 * 60);
    for (let h = 0; h * 60 * 60_000 < MAX_KEEP_MS; h++) s.push(hour);
    expect(s.full).toBe(false);
    s.push(new Float32Array(RATE));
    expect(s.full).toBe(true);
  });
});

describe("windows", () => {
  it("cuts a source at pauses into whole stretches of at most 28 s", () => {
    const s = storeOf([quiet(1_000), speech(12_000, 2), quiet(3_000), speech(40_000, 3), quiet(2_000)]);
    const w = windowsOf(s, "others", null);
    expect(w.length).toBeGreaterThanOrEqual(3);
    for (const x of w) {
      expect(x.endMs - x.startMs).toBeLessThanOrEqual(28_000);
      expect(x.speaker).toBe("others");
    }
    // The first stretch is one window, not cut into short live-sized pieces.
    expect(w[0]!.startMs).toBeLessThan(1_000);
    expect(w[0]!.endMs).toBeGreaterThan(12_000);
  });

  it("times the mic from where it opened", () => {
    const s = storeOf([quiet(1_000), speech(5_000, 4), quiet(4_000)], 700);
    const [w] = windowsOf(s, "you", null);
    expect(w!.startMs).toBeGreaterThan(1_300);
    expect(w!.startMs).toBeLessThan(1_800);
  });

  it("leaves the call's echo on the mic out, keeps the user's own words", () => {
    const callAudio = [quiet(1_000), speech(8_000, 5), quiet(6_000), quiet(1_000)];
    const call = storeOf(callAudio);
    // The mic: the call leaking in 200 ms later and quieter, then the user talking alone.
    const leak = new Float32Array(16 * RATE);
    const all = call.read();
    for (let i = 0; i < 9 * RATE; i++) leak[i] = (all[i - 0.2 * RATE] ?? 0) * 0.2;
    leak.set(speech(5_000, 6), 10 * RATE);
    const mic = storeOf([leak]);
    const echo = echoOf(call);
    const w = windowsOf(mic, "you", echo);
    expect(w).toHaveLength(1);
    expect(w[0]!.startMs).toBeGreaterThan(9_500);
    expect(windowsOf(mic, "you", null)[0]!.startMs).toBeLessThan(2_000);
  });
});

describe("lines from the model's sentences", () => {
  const window: Window = { speaker: "others", startMs: 10_000, endMs: 30_000, audio: speech(20_000, 7) };

  it("places each sentence in the recording", () => {
    const lines = linesOf(
      window,
      [
        { start: 0, end: 4.2, text: " Let's ship it on Thursday." },
        { start: 4.5, end: 9, text: "Eve writes the notes." },
      ],
      "",
    );
    expect(lines).toEqual([
      { speaker: "others", startMs: 10_000, endMs: 14_200, text: "Let's ship it on Thursday." },
      { speaker: "others", startMs: 14_500, endMs: 19_000, text: "Eve writes the notes." },
    ]);
  });

  it("uses the whole window without sentence times, and drops repeats and tags", () => {
    expect(linesOf(window, undefined, "Hello all.")).toEqual([{ speaker: "others", startMs: 10_000, endMs: 30_000, text: "Hello all." }]);
    const lines = linesOf(
      window,
      [
        { start: 0, end: 2, text: "Thanks." },
        { start: 2, end: 4, text: "Thanks." },
        { start: 4, end: 6, text: "[BLANK_AUDIO]" },
      ],
      "",
    );
    expect(lines.map((l) => l.text)).toEqual(["Thanks."]);
  });

  it("drops a phantom on the mic with no voice behind it", () => {
    const mic: Window = { speaker: "you", startMs: 0, endMs: 3_000, audio: quiet(3_000) };
    expect(linesOf(mic, [{ start: 0, end: 3, text: "Thank you." }], "")).toEqual([]);
  });

  it("puts both sources in the order they were said", () => {
    const merged = inOrder([
      { speaker: "you", startMs: 5_000, endMs: 6_000, text: "b" },
      { speaker: "others", startMs: 1_000, endMs: 2_000, text: "a" },
      { speaker: "others", startMs: 5_000, endMs: 5_500, text: "c" },
    ]);
    expect(merged.map((l) => l.text)).toEqual(["a", "c", "b"]);
  });

  it("reads Whisper's timestamped output", () => {
    expect(
      timedChunks(
        [
          {
            text: "a b",
            chunks: [
              { timestamp: [0, 1.5], text: " a" },
              { timestamp: [1.5, null], text: " b" },
              { timestamp: [2, 2.5], text: "  " },
            ],
          },
        ],
        3,
      ),
    ).toEqual([
      { start: 0, end: 1.5, text: "a" },
      { start: 1.5, end: 3, text: "b" },
    ]);
  });
});
