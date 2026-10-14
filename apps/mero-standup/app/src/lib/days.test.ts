import { describe, expect, it } from "vitest";
import {
  dayOf,
  describeDay,
  describeWeek,
  parseDay,
  relativeTime,
  shiftDay,
  today,
  weekDays,
  weekStart,
  weekdayShort,
} from "./days";

describe("standup days", () => {
  it("formats the LOCAL date, zero-padded", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(today(new Date(2026, 9, 13, 0, 1))).toBe("2026-10-13");
  });

  it("parses only real dates", () => {
    expect(parseDay("2026-10-13")).not.toBeNull();
    expect(parseDay("2028-02-29")).not.toBeNull();
    for (const bad of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-01", "today", ""]) {
      expect(parseDay(bad), bad).toBeNull();
    }
  });

  it("shifts across month, year and leap boundaries", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("not-a-day", 1)).toBe("not-a-day");
  });

  it("names the days around now", () => {
    const now = new Date(2026, 9, 13, 9);
    expect(describeDay("2026-10-13", now)).toBe("Today");
    expect(describeDay("2026-10-12", now)).toBe("Yesterday");
    expect(describeDay("2026-10-14", now)).toBe("Tomorrow");
    expect(describeDay("2026-10-01", now)).not.toBe("2026-10-01");
  });
});


describe("relative times and weeks", () => {
  const now = new Date(2026, 9, 13, 15, 0);
  const ns = (d: Date) => d.getTime() * 1e6;

  it("says how long ago, coarsely", () => {
    expect(relativeTime(ns(new Date(2026, 9, 13, 14, 59, 40)), now)).toBe("just now");
    expect(relativeTime(ns(new Date(2026, 9, 13, 14, 55)), now)).toBe("5m ago");
    expect(relativeTime(ns(new Date(2026, 9, 13, 12, 0)), now)).toBe("3h ago");
    expect(relativeTime(ns(new Date(2026, 9, 12, 9, 0)), now)).toBe("yesterday");
    expect(relativeTime(0, now)).toBe("");
  });

  it("weeks start on Monday, across month boundaries", () => {
    expect(weekStart("2026-10-14")).toBe("2026-10-12"); // Wed -> Mon
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Mon
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sun
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sun, previous month
    expect(weekDays("2026-10-26")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(weekdayShort("2026-10-12")).toMatch(/Mon/);
    expect(describeWeek("2026-10-26")).toMatch(/–/);
  });
});
