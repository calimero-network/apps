import { describe, expect, it } from "vitest";
import { activeIndex, nextRate, speakerLanes } from "./playback";
import { formatShare, talkStats } from "./stats";

const line = (startMs: number, endMs: number, name: string, text = "a b c") => ({ startMs, endMs, name, text });

describe("activeIndex", () => {
  const lines = [line(1_000, 3_000, "A"), line(3_500, 6_000, "B"), line(9_000, 10_000, "A")];
  it("is -1 before the first line", () => expect(activeIndex(lines, 500)).toBe(-1));
  it("is the last line started", () => {
    expect(activeIndex(lines, 1_000)).toBe(0);
    expect(activeIndex(lines, 3_200)).toBe(0);
    expect(activeIndex(lines, 3_500)).toBe(1);
    expect(activeIndex(lines, 8_999)).toBe(1);
    expect(activeIndex(lines, 9_500)).toBe(2);
  });
  it("lets go a while after the last line", () => {
    expect(activeIndex(lines, 13_000)).toBe(2);
    expect(activeIndex(lines, 14_001)).toBe(-1);
  });
  it("handles no lines", () => expect(activeIndex([], 100)).toBe(-1));
});

describe("speakerLanes", () => {
  it("merges close stretches and keeps the given order", () => {
    const lanes = speakerLanes(
      [line(0, 1_000, "A"), line(1_500, 2_000, "A"), line(5_000, 6_000, "B"), line(8_000, 10_000, "A")],
      (l) => l.name,
      ["B", "A"],
      10_000,
    );
    expect(lanes.map((l) => l.label)).toEqual(["B", "A"]);
    expect(lanes[1]!.spans).toEqual([
      { from: 0, to: 0.2 },
      { from: 0.8, to: 1 },
    ]);
    expect(lanes[0]!.spans).toEqual([{ from: 0.5, to: 0.6 }]);
  });
});

describe("nextRate", () => {
  it("cycles", () => {
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(2)).toBe(1);
    expect(nextRate(3)).toBe(1);
  });
});

describe("talkStats", () => {
  it("counts talk time, turns, questions and shares", () => {
    const s = talkStats(
      [
        line(0, 10_000, "A", "We should ship on Friday."),
        line(10_000, 20_000, "A", "Everyone agree?"),
        line(20_000, 25_000, "B", "Yes, Friday works."),
        line(25_000, 55_000, "A", "Great, then I will write the notes and send them around today"),
      ],
      (l) => l.name,
    );
    expect(s.totalTalkMs).toBe(55_000);
    const [a, b] = s.speakers;
    expect(a!.label).toBe("A");
    expect(a!.talkMs).toBe(50_000);
    expect(a!.turns).toBe(2);
    expect(a!.questions).toBe(1);
    expect(a!.longestTurnMs).toBe(30_000);
    expect(a!.share).toBeCloseTo(50 / 55);
    expect(b!.turns).toBe(1);
    expect(b!.wpm).toBe(0); // under 10 s of speech
    expect(a!.wpm).toBe(Math.round(a!.words / (50_000 / 60_000)));
  });
  it("is empty for no lines", () => expect(talkStats([], () => "x")).toEqual({ speakers: [], totalTalkMs: 0, totalWords: 0 }));
});

describe("formatShare", () => {
  it("rounds", () => {
    expect(formatShare(0.4234)).toBe("42%");
    expect(formatShare(0.001)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
  });
});
