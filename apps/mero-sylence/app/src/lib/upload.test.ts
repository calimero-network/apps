import { describe, expect, it } from "vitest";
import {
  assignSpeakers,
  audioMime,
  batches,
  clusterVoices,
  cutPoints,
  isAudioFile,
  labelSpeakers,
  MAX_AUDIO_BYTES,
  RATE,
  titleFromFile,
  toSegmentInputs,
  tooLargeForAudio,
} from "./upload";

describe("assignSpeakers", () => {
  const turns = [
    { start: 0, end: 4, id: 7 },
    { start: 4, end: 9, id: 3 },
  ];

  it("gives each sentence the voice that overlaps it most", () => {
    const out = assignSpeakers(
      [
        { start: 0.5, end: 3.5, text: "Hi all." },
        { start: 3.5, end: 8, text: "Thanks, let's go." },
      ],
      turns,
    );
    expect(out.map((l) => l.speakerIndex)).toEqual([7, 3]);
    expect(out[0]).toMatchObject({ startMs: 500, endMs: 3500, text: "Hi all." });
  });

  it("takes the nearest voice when none overlaps", () => {
    const out = assignSpeakers([{ start: 9.5, end: 10, text: "Bye." }], turns);
    expect(out[0]!.speakerIndex).toBe(3);
  });

  it("is -1 without any voices", () => {
    expect(assignSpeakers([{ start: 0, end: 1, text: "x" }], [])[0]!.speakerIndex).toBe(-1);
  });

  it("never ends a line before it starts", () => {
    const out = assignSpeakers([{ start: 5, end: 4, text: "x" }], turns);
    expect(out[0]!.endMs).toBe(5000);
  });
});

describe("labelSpeakers", () => {
  it("numbers voices by who spoke first", () => {
    const lines = [5, 2, 5, -1].map((speakerIndex, i) => ({ startMs: i, endMs: i + 1, speakerIndex, text: "t" }));
    expect(labelSpeakers(lines).map((l) => l.label)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 3"]);
  });
});

describe("toSegmentInputs", () => {
  it("numbers from 0, skips empty lines, names the speaker", () => {
    const out = toSegmentInputs([
      { startMs: 0, endMs: 1_000, speakerIndex: 0, text: "  Hello   there ", label: "Speaker 1" },
      { startMs: 1_000, endMs: 2_000, speakerIndex: 1, text: "   ", label: "Speaker 2" },
      { startMs: 2_000, endMs: 3_000, speakerIndex: 1, text: "Hi.", label: "Speaker 2" },
    ]);
    expect(out).toEqual([
      { seq: 0, startMs: 0, endMs: 1_000, speaker: "others", name: "Speaker 1", text: "Hello there" },
      { seq: 1, startMs: 2_000, endMs: 3_000, speaker: "others", name: "Speaker 2", text: "Hi." },
    ]);
  });

  it("caps a line at 4,000 characters", () => {
    const out = toSegmentInputs([{ startMs: 0, endMs: 5_000, speakerIndex: 0, text: "a".repeat(5_000), label: "Speaker 1" }]);
    expect(out[0]!.text.length).toBe(4_000);
  });

  it("splits a line over 30 s at sentence ends, sharing out its time", () => {
    const text = "One two three four. Five six seven eight. Nine ten eleven twelve.";
    const out = toSegmentInputs([{ startMs: 10_000, endMs: 70_000, speakerIndex: 0, text, label: "Speaker 1" }]);
    expect(out.length).toBe(2);
    expect(out.map((s) => s.seq)).toEqual([0, 1]);
    expect(out[0]!.startMs).toBe(10_000);
    expect(out[1]!.endMs).toBe(70_000);
    expect(out[0]!.endMs).toBe(out[1]!.startMs);
    expect(out.map((s) => s.text).join(" ")).toBe(text);
  });
});

describe("batches", () => {
  it("cuts into runs of at most the size", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 100)).toEqual([]);
  });
});

describe("files", () => {
  it("titles a meeting from its file name", () => {
    expect(titleFromFile("weekly_sync-2026.11.20.m4a")).toBe("weekly sync 2026 11 20");
    expect(titleFromFile(".mp3")).toBe("Uploaded recording");
    expect(titleFromFile(`${"x".repeat(300)}.wav`).length).toBe(200);
  });

  it("knows the type from the extension when the browser gives none", () => {
    expect(audioMime({ name: "a.MP3", type: "" })).toBe("audio/mpeg");
    expect(audioMime({ name: "a.m4a", type: "audio/x-m4a" })).toBe("audio/x-m4a");
    expect(audioMime({ name: "notes.txt", type: "text/plain" })).toBe("");
    expect(isAudioFile({ name: "call.webm", type: "" })).toBe(true);
    expect(isAudioFile({ name: "doc.pdf", type: "application/pdf" })).toBe(false);
  });

  it("says why a large file is saved without its audio", () => {
    expect(tooLargeForAudio(MAX_AUDIO_BYTES)).toBeNull();
    expect(tooLargeForAudio(MAX_AUDIO_BYTES + 1)).toMatch(/without the audio/);
  });
});

describe("cutPoints", () => {
  it("covers the audio in windows of at most the length, cut at a quiet moment", () => {
    const audio = new Float32Array(70 * RATE).fill(0.5);
    // Silence around 28 s.
    audio.fill(0, 28 * RATE, 28.2 * RATE);
    const w = cutPoints(audio, 30, 5);
    expect(w[0]![0]).toBe(0);
    expect(w.at(-1)![1]).toBe(audio.length);
    for (let i = 1; i < w.length; i++) expect(w[i]![0]).toBe(w[i - 1]![1]);
    for (const [a, b] of w) expect(b - a).toBeLessThanOrEqual(30 * RATE);
    expect(Math.abs(w[0]![1] - 28.05 * RATE)).toBeLessThan(0.1 * RATE);
  });

  it("is one window for short audio", () => {
    expect(cutPoints(new Float32Array(RATE))).toEqual([[0, RATE]]);
    expect(cutPoints(new Float32Array(0))).toEqual([[0, 0]]);
  });
});

describe("clusterVoices", () => {
  it("groups alike voices and keeps different ones apart", () => {
    const a = [1, 0.1, 0];
    const a2 = [0.95, 0.15, 0.02];
    const b = [0, 1, 0.1];
    const b2 = [0.05, 0.9, 0.1];
    const out = clusterVoices([a, b, a2, b2]);
    expect(out[0]).toBe(out[2]);
    expect(out[1]).toBe(out[3]);
    expect(out[0]).not.toBe(out[1]);
    expect(new Set(out)).toEqual(new Set([0, 1]));
  });

  it("folds a voice with very little speech into its closest", () => {
    const out = clusterVoices(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0.3, 0, 1],
      ],
      [100, 100, 1],
    );
    expect(new Set(out).size).toBe(2);
  });

  it("answers nothing for nothing", () => {
    expect(clusterVoices([])).toEqual([]);
  });
});
