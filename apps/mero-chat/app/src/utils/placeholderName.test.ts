import { describe, expect, it } from "vitest";
import { isPlaceholderName } from "./placeholderName";

describe("isPlaceholderName", () => {
  it.each([
    "",
    "   ",
    undefined,
    "3e76…db86",
    "3e76...db86",
    "3e76abcd…db8611",
    "3e76".padEnd(64, "a"),
    "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqv",
    "unknown",
    "Unnamed member",
  ])("treats %j as no name", (name) => {
    expect(isPlaceholderName(name)).toBe(true);
  });

  it.each(["sandi", "Ana Marija", "x", "3", "bob...", "ab…"])(
    "treats %j as a chosen name",
    (name) => {
      expect(isPlaceholderName(name)).toBe(false);
    },
  );
});
