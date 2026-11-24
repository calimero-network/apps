import { describe, expect, it } from "vitest";
import type { SegmentView } from "../generated/client";
import {
  formatClock,
  formatDuration,
  highlightParts,
  matchesAll,
  queryWords,
  markdownFileName,
  mergeSegments,
  platformName,
  rangeToRead,
  searchMeetings,
  speakerLabel,
  toMarkdown,
} from "./transcript";

const seg = (seq: number, text: string, speaker = "others", startMs = seq * 3_000): SegmentView => ({
  seq,
  startMs,
  endMs: startMs + 2_500,
  speaker,
  text,
  edited: false,
});

describe("mergeSegments", () => {
  it("keeps one segment per number, in order, the newest copy winning", () => {
    const merged = mergeSegments([seg(0, "a"), seg(2, "c")], [seg(1, "b"), { ...seg(2, "C"), edited: true }]);
    expect(merged.map((s) => s.text)).toEqual(["a", "b", "C"]);
    expect(merged[2]!.edited).toBe(true);
  });

  it("returns the same array when nothing arrives", () => {
    const existing = [seg(0, "a")];
    expect(mergeSegments(existing, [])).toBe(existing);
  });
});

describe("rangeToRead", () => {
  it("re-reads a change inside what is loaded", () => {
    expect(rangeToRead({ from: 3, to: 5 }, 10)).toEqual({ fromSeq: 3, limit: 2 });
  });
  it("re-reads only the loaded part of a change that runs past it", () => {
    expect(rangeToRead({ from: 8, to: 20 }, 10)).toEqual({ fromSeq: 8, limit: 2 });
  });
  it("leaves a change past what is loaded to the next page", () => {
    expect(rangeToRead({ from: 10, to: 12 }, 10)).toBeNull();
  });
  it("reads every new line once the whole transcript is in", () => {
    expect(rangeToRead({ from: 40, to: 43 }, null)).toEqual({ fromSeq: 40, limit: 3 });
  });
  it("caps a read at 500 and ignores an empty range", () => {
    expect(rangeToRead({ from: 0, to: 2_000 }, null)).toEqual({ fromSeq: 0, limit: 500 });
    expect(rangeToRead({ from: 4, to: 4 }, null)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats clock offsets", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_400)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
  it("formats durations", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
    expect(formatDuration(120 * 60_000)).toBe("2 h");
  });
  it("names platforms and speakers", () => {
    expect(platformName("meet")).toBe("Google Meet");
    expect(platformName("webex")).toBe("Call");
    expect(speakerLabel("you", "Ana")).toBe("Ana");
    expect(speakerLabel("others", "Ana")).toBe("Others");
  });
  it("makes a file name from a title", () => {
    expect(markdownFileName("Q1 Roadmap: review / sign-off!")).toBe("q1-roadmap-review-sign-off.md");
    expect(markdownFileName("   ")).toBe("meeting.md");
  });
});

describe("searchMeetings", () => {
  const meetings = [{ title: "Weekly sync" }, { title: "Roadmap review" }, { title: "Sync with design" }];
  it("matches every word, any case, any order", () => {
    expect(searchMeetings(meetings, "SYNC")).toEqual([meetings[0], meetings[2]]);
    expect(searchMeetings(meetings, "design sync")).toEqual([meetings[2]]);
    expect(searchMeetings(meetings, "  ")).toBe(meetings);
    expect(searchMeetings(meetings, "budget")).toEqual([]);
  });
});

describe("toMarkdown", () => {
  it("writes the meeting, its summary, action items and transcript", () => {
    const md = toMarkdown(
      {
        title: "Weekly sync",
        platform: "meet",
        startedAt: String(Date.UTC(2026, 10, 23, 13, 5)),
        durationMs: 1_800_000,
        summary: "Scope agreed.",
      },
      [seg(0, "Morning all", "you", 0), seg(1, "Cy will send the deck", "others", 65_000)],
      [
        { text: "Send the deck", assignee: "Cy", done: false },
        { text: "Book the room", assignee: "", done: true },
      ],
      "Ana",
      "en-GB",
    );
    const when = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(Date.UTC(2026, 10, 23, 13, 5)));
    expect(md).toBe(
      [
        "# Weekly sync",
        "",
        `${when} · Google Meet · 30 min`,
        "",
        "## Summary",
        "",
        "Scope agreed.",
        "",
        "## Action items",
        "",
        "- [ ] Send the deck (Cy)",
        "- [x] Book the room",
        "",
        "## Transcript",
        "",
        "**0:00 Ana:** Morning all",
        "",
        "**1:05 Others:** Cy will send the deck",
        "",
      ].join("\n"),
    );
  });

  it("says so when there is no transcript, and skips empty sections", () => {
    const md = toMarkdown({ title: "Empty", platform: "zoom", startedAt: "0", durationMs: 0, summary: "" }, [], [], "You");
    expect(md).toBe("# Empty\n\nZoom\n\n## Transcript\n\n_No transcript yet._\n");
  });

  it("matches every word and marks them for highlighting", () => {
    expect(queryWords("  Pricing  PAGE ")).toEqual(["pricing", "page"]);
    expect(matchesAll("The new pricing page", ["page", "pricing"])).toBe(true);
    expect(matchesAll("The new pricing", ["page", "pricing"])).toBe(false);
    expect(highlightParts("Price (beta) and PRICE", ["price", "(beta)"])).toEqual([
      { text: "Price", hit: true },
      { text: " ", hit: false },
      { text: "(beta)", hit: true },
      { text: " and ", hit: false },
      { text: "PRICE", hit: true },
    ]);
    expect(highlightParts("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });
});
