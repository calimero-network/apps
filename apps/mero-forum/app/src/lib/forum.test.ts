import { describe, expect, it } from "vitest";

import { shortAuthor, timeAgo } from "./forum";

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

describe("shortAuthor", () => {
  it("abbreviates a 64-hex account id", () => {
    const id = "a".repeat(60) + "beef";
    expect(shortAuthor(id)).toBe("aaaaaa…beef");
  });

  it("leaves a short id alone rather than mangling it", () => {
    expect(shortAuthor("alice")).toBe("alice");
  });
});
