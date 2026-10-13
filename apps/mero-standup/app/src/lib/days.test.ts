import { describe, expect, it } from "vitest";
import { dayOf, describeDay, parseDay, shiftDay, today } from "./days";

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
