import { describe, expect, it } from "vitest";

import { fullDate, shortAuthor, timeAgo, toMs } from "./forum";

describe("timeAgo", () => {
  const now = 1_700_000_000_000;
  it("reads in the units a reader expects", () => {
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("does not render a negative age from a peer's clock skew", () => {
    // Timestamps come from whichever node wrote the post, so one running a
    // little ahead is normal and must not produce "-3m ago".
    expect(timeAgo(now + 60_000, now)).toBe("just now");
  });
});

describe("contract timestamps are nanoseconds", () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  const ns = (ms: number) => ms * 1e6;

  it("scales a nanosecond time to milliseconds and leaves milliseconds alone", () => {
    expect(toMs(ns(now))).toBe(now);
    expect(toMs(now)).toBe(now);
  });

  it("ages a nanosecond time instead of calling everything 'just now'", () => {
    expect(timeAgo(ns(now - 3 * 3_600_000), now)).toBe("3h ago");
  });

  it("formats a nanosecond time as a real date", () => {
    expect(fullDate(ns(now))).not.toBe("Invalid Date");
    expect(fullDate(ns(now))).toBe(new Date(now).toLocaleString());
  });
});

describe("shortAuthor", () => {
  it("abbreviates a 64-hex account id", () => {
    const id = "a".repeat(60) + "beef";
    expect(shortAuthor(id)).toBe("aaaaaa…beef");
  });

  it("leaves a short id alone rather than mangling it", () => {
    expect(shortAuthor("alice")).toBe("alice");
  });
});
