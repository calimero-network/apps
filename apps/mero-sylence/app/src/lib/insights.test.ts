import { describe, expect, it } from "vitest";
import {
  aggregateEmotions,
  assignedTo,
  buildInsights,
  keyPoints,
  llmPrompt,
  parseLlm,
  profileFor,
  sentencesOf,
  TONE_GROUPS,
  type AnalyzedLine,
} from "./insights";
import { talkStats } from "./stats";

describe("TONE_GROUPS", () => {
  it("covers the 28 GoEmotions labels", () => {
    expect(Object.keys(TONE_GROUPS)).toHaveLength(28);
    expect(TONE_GROUPS.excitement).toBe("enthusiastic");
    expect(TONE_GROUPS.curiosity).toBe("curious");
    expect(TONE_GROUPS.annoyance).toBe("frustrated");
    expect(TONE_GROUPS.neutral).toBe("neutral");
  });
});

describe("aggregateEmotions", () => {
  it("is neutral with no scores", () => {
    expect(aggregateEmotions([])).toEqual({ tone: "neutral", emotions: [] });
  });

  it("reads a mostly neutral person who is excited at times as enthusiastic", () => {
    const lines: { words: number; scores: Record<string, number> }[] = [
      { words: 10, scores: { neutral: 0.9, excitement: 0.05 } },
      { words: 10, scores: { neutral: 0.9, approval: 0.05 } },
      { words: 10, scores: { excitement: 0.8, joy: 0.3, neutral: 0.1 } },
    ];
    const r = aggregateEmotions(lines);
    expect(r.tone).toBe("enthusiastic");
    expect(r.emotions.reduce((n, e) => n + e.share, 0)).toBeLessThanOrEqual(1000);
    expect(r.emotions.length).toBeLessThanOrEqual(6);
  });

  it("stays neutral when the emotional mass is small", () => {
    const r = aggregateEmotions([{ words: 20, scores: { neutral: 0.97, annoyance: 0.02 } }]);
    expect(r.tone).toBe("neutral");
    expect(r.emotions[0]!.label).toBe("neutral");
  });

  it("weights by words", () => {
    const r = aggregateEmotions([
      { words: 40, scores: { anger: 0.9 } },
      { words: 2, scores: { joy: 0.9 } },
    ]);
    expect(r.tone).toBe("frustrated");
    expect(r.emotions[0]).toMatchObject({ label: "anger" });
  });
});

describe("keyPoints", () => {
  const at = (startMs: number, text: string) => ({ label: "A", startMs, text });

  it("splits sentences", () => {
    expect(sentencesOf("We ship Friday. Then rest! OK?")).toEqual(["We ship Friday.", "Then rest!", "OK?"]);
  });

  it("prefers decisions and numbers, skips filler, keeps time order", () => {
    const lines = [
      at(0, "Yeah okay so."),
      at(1_000, "I had a sandwich for lunch earlier today and it was fine."),
      at(2_000, "We decided to launch the beta on Friday the 14th with 200 users."),
      at(3_000, "Let's move the pricing review to next week so finance can join."),
    ];
    const kp = keyPoints(lines, lines, 2);
    expect(kp.map((k) => k.startMs)).toEqual([2_000, 3_000]);
    expect(kp.some((k) => /Yeah/.test(k.text))).toBe(false);
  });

  it("drops near duplicates", () => {
    const lines = [
      at(0, "We need to ship the onboarding flow before the launch."),
      at(1, "We need to ship the onboarding flow before launch."),
    ];
    expect(keyPoints(lines, lines, 5)).toHaveLength(1);
  });

  it("caps a point at 400 characters", () => {
    const long = `We decided ${"that the plan will cover many things ".repeat(20)}.`;
    const [p] = keyPoints([at(0, long)]);
    expect(p!.text.length).toBeLessThanOrEqual(400);
  });
});

describe("profileFor", () => {
  const st = { share: 0.42, questions: 6, turns: 9, longestTurnMs: 20_000, wpm: 140 };
  it("says how the person came across", () => {
    expect(profileFor(st, "enthusiastic", [], 3, 0, 3)).toBe("Enthusiastic and talked the most (42% of the meeting); asked 6 questions.");
  });
  it("is deterministic and mentions a strong emotion and long turns", () => {
    const p = profileFor({ ...st, questions: 1, longestTurnMs: 120_000 }, "concerned", [{ label: "nervousness", share: 300 }], 2, 1, 3);
    expect(p).toBe("Concerned and spoke 42% of the meeting; asked 1 question, held the floor for up to 2 min at a time, mostly nervousness.");
    expect(profileFor(st, "concerned", [], 2, 1, 3)).toBe(profileFor(st, "concerned", [], 2, 1, 3));
  });
});

describe("buildInsights", () => {
  it("gives every speaker a record within the contract's limits", () => {
    const line = (label: string, i: number, text: string, scores: Record<string, number>): AnalyzedLine => ({
      label,
      startMs: i * 5_000,
      text,
      words: text.split(/\s+/).length,
      scores,
    });
    const lines = [
      line("Speaker 1", 0, "We will ship the new dashboard on Friday after the review.", { excitement: 0.7, neutral: 0.2 }),
      line("Speaker 2", 1, "What happens with the old reports when we switch over?", { curiosity: 0.8 }),
      line("Speaker 1", 2, "They stay readable for 30 days, then we archive them.", { neutral: 0.9 }),
    ];
    const stats = talkStats(
      lines.map((l) => ({ ...l, endMs: l.startMs + 4_000 })),
      (l) => l.label,
    );
    const input = buildInsights(lines, stats, "go-emotions");
    expect(input.model).toBe("go-emotions");
    expect(input.people.map((p) => p.label)).toEqual(["Speaker 1", "Speaker 2"]);
    expect(input.people[1]!.tone).toBe("curious");
    for (const p of input.people) {
      expect(p.keyPoints.length).toBeLessThanOrEqual(8);
      expect(p.emotions.length).toBeLessThanOrEqual(8);
      expect(p.profile.length).toBeLessThanOrEqual(1000);
      expect(Object.keys(p).sort()).toEqual(["emotions", "keyPoints", "label", "profile", "tone"]);
    }
  });
});

describe("Smart notes pass", () => {
  it("prompts with the person's lines, within budget", () => {
    const lines = Array.from({ length: 400 }, (_, i) => ({ label: "A", startMs: i, text: `line number ${i} about the roadmap` }));
    const [system, user] = llmPrompt("Eve", lines, { tone: "positive", share: 0.3 });
    expect(system!.content).toContain("PROFILE:");
    expect(user!.content).toContain("Person: Eve");
    expect(user!.content.length).toBeLessThan(5_400);
  });

  it("reads the answer back", () => {
    expect(parseLlm("PROFILE:\nCalm, focused on dates.\nPOINTS:\n- Beta ships Friday\n- 1. Pricing next week\n* none")).toEqual({
      profile: "Calm, focused on dates.",
      keyPoints: ["Beta ships Friday", "1. Pricing next week"],
    });
    expect(parseLlm("Sure! Here are notes.")).toBeNull();
    expect(parseLlm("PROFILE:\n\nPOINTS:\n- x y z")).toBeNull();
  });
});

describe("assignedTo", () => {
  it("matches the assignee to a name or label, any case", () => {
    expect(assignedTo("eve", "Eve", "Speaker 1")).toBe(true);
    expect(assignedTo("Eve and Sam", "Sam", "Speaker 2")).toBe(true);
    expect(assignedTo("Speaker 1", "Eve", "Speaker 1")).toBe(true);
    expect(assignedTo("Eve", "Eve Parker", "Speaker 1")).toBe(true);
    expect(assignedTo("", "Eve")).toBe(false);
    expect(assignedTo("design team", "Eve")).toBe(false);
  });
});
