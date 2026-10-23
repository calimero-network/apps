import { describe, expect, it } from "vitest";
import { avatarHue, displayName, initials, shortAccount } from "./people";

const A = "a1".repeat(32);

describe("people", () => {
  it("shortens an account for a byline", () => {
    expect(shortAccount(A)).toBe("a1a1a1…a1a1");
    expect(shortAccount("abc")).toBe("abc");
  });

  it("prefers a given name, then the namespace name, then the id", () => {
    expect(displayName(A, " Ada ", "Ada L")).toBe("Ada");
    expect(displayName(A, "", "Ada L")).toBe("Ada L");
    expect(displayName(A, null)).toBe("a1a1a1…a1a1");
  });

  it("takes two initials, or the start of the id", () => {
    expect(initials(A, "Ada Lovelace")).toBe("AL");
    expect(initials(A, "Ada")).toBe("AD");
    expect(initials(A, "")).toBe("A1");
  });

  it("keeps an avatar colour per account", () => {
    expect(avatarHue(A)).toBe(avatarHue(A));
    expect(avatarHue(A)).toBeGreaterThanOrEqual(0);
    expect(avatarHue(A)).toBeLessThan(360);
  });
});
