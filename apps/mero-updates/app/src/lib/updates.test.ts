import { describe, expect, it } from "vitest";

import { deltaLabel, dueLabel, parseMetric, personLabel, timeAgo } from "./updates";
import {
  TEMPLATES,
  fromTemplate,
  parseDraft,
  publishBlocker,
  thanksSection,
  toInput,
} from "./templates";

describe("parseMetric", () => {
  it.each([
    ["$1.2M", 1_200_000],
    ["38%", 38],
    ["12.5k", 12_500],
    ["1,204", 1204],
    ["-3.5", -3.5],
    ["18 months", 18],
  ])("%s → %d", (input, expected) => {
    expect(parseMetric(input)).toBeCloseTo(expected);
  });

  it("returns null when there is no number, so text is not charted as zero", () => {
    expect(parseMetric("n/a")).toBeNull();
    expect(parseMetric("TBD")).toBeNull();
  });
});

describe("deltaLabel", () => {
  it("reports growth and decline", () => {
    expect(deltaLabel("$42k", "$48k")).toBe("+14%");
    expect(deltaLabel("100", "96")).toBe("−4%");
    expect(deltaLabel("10", "10")).toBe("±0%");
  });
  it("has nothing to say about non-numbers or a zero base", () => {
    expect(deltaLabel("n/a", "5")).toBeNull();
    expect(deltaLabel("0", "5")).toBeNull();
  });
});

describe("time labels", () => {
  const now = 1_700_000_000_000;
  it("dueLabel counts whole days either side", () => {
    expect(dueLabel(now + 3 * 86_400_000, now)).toBe("Due in 3 days");
    expect(dueLabel(now, now)).toBe("Due today");
    expect(dueLabel(now - 86_400_000, now)).toBe("1 day overdue");
  });
  it("timeAgo treats 0 as never", () => {
    expect(timeAgo(0, now)).toBe("never");
    expect(timeAgo(now - 90_000, now)).toBe("1m ago");
  });
  it("personLabel falls back to a short id", () => {
    expect(personLabel("  ", "a".repeat(64))).toBe("aaaaaa…aaaa");
    expect(personLabel("Ana", "a".repeat(64))).toBe("Ana");
  });
});

describe("composer", () => {
  const monthly = TEMPLATES.find((t) => t.id === "monthly")!;
  const series = [{ name: "MRR", unit: "", points: [] }];

  it("a template carries every KPI name forward with an empty value", () => {
    const s = fromTemplate(monthly, series, "cat");
    expect(s.metrics).toEqual([{ name: "MRR", value: "", unit: "" }]);
    expect(s.categoryId).toBe("cat");
    expect(s.sections.map((x) => x.title)).toContain("Lowlights");
  });

  it("publishing drops blank sections, KPIs and asks", () => {
    const s = fromTemplate(monthly, series);
    s.sections[0].body = "We shipped.";
    const input = toInput(s);
    expect(input.sections).toHaveLength(1);
    expect(input.metrics).toHaveLength(0);
    expect(input.asks).toHaveLength(0);
  });

  it("explains why it cannot publish yet", () => {
    const s = fromTemplate(TEMPLATES.find((t) => t.id === "blank")!, []);
    expect(publishBlocker(s)).toMatch(/title/);
    s.title = "News";
    expect(publishBlocker(s)).toMatch(/at least one/);
    s.sections[0].body = "x";
    expect(publishBlocker(s)).toBeNull();
  });

  it("a thanks section names each contributor", () => {
    const section = thanksSection([
      {
        ask_id: "a",
        ask_title: "Intro to a CFO",
        ask_kind: "intro",
        account: "b".repeat(64),
        name: "Ben",
        firm: "Seed Fund",
        note: "",
        accepted_at: 1,
      },
    ]);
    expect(section?.body).toBe("• Ben (Seed Fund) — intro: Intro to a CFO");
    expect(thanksSection([])).toBeNull();
  });

  it("a corrupt draft does not crash the composer", () => {
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft('{"title":"x"}')?.sections).toEqual([]);
  });
});
