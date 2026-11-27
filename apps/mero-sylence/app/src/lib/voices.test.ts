import { describe, expect, it } from "vitest";
import { canTellVoices, inRuns, unnamedLines, voiceNames } from "./voices";

const line = (seq: number, startMs: number, endMs: number, name = "", speaker = "others") => ({ seq, speaker, name, startMs, endMs });

describe("telling voices apart", () => {
  it("names each unnamed line after the voice overlapping it most, numbered by who spoke first", () => {
    const lines = [line(0, 0, 2_000), line(1, 2_100, 4_000), line(2, 4_100, 6_000), line(3, 6_100, 7_000, "Eve"), line(4, 7_100, 8_000, "", "you")];
    const turns = [
      { start: 0, end: 2.05, id: 7 },
      { start: 2.05, end: 4.05, id: 3 },
      { start: 4.05, end: 6.2, id: 7 },
    ];
    expect(voiceNames(lines, turns)).toEqual([
      { seq: 0, name: "Voice 1" },
      { seq: 1, name: "Voice 2" },
      { seq: 2, name: "Voice 1" },
    ]);
  });

  it("leaves lines alone when there are no voices", () => {
    expect(voiceNames([line(0, 0, 1_000)], [])).toEqual([]);
  });

  it("offers itself only for a meeting with its recording and unnamed lines", () => {
    expect(canTellVoices({ audio: { blob: "b" } }, [line(0, 0, 1)])).toBe(true);
    expect(canTellVoices({ audio: null }, [line(0, 0, 1)])).toBe(false);
    expect(canTellVoices({ audio: { blob: "b" } }, [line(0, 0, 1, "Eve"), line(1, 0, 1, "", "you")])).toBe(false);
    expect(unnamedLines([line(0, 0, 1, "  ")])).toHaveLength(1);
  });

  it("names at most 500 lines a call", () => {
    expect(inRuns(Array.from({ length: 1_201 }, (_, i) => i)).map((r) => r.length)).toEqual([500, 500, 201]);
  });
});
