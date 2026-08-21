import { describe, expect, it } from "vitest";

import { formatTyping } from "./useEphemeralPresence";

describe("formatTyping", () => {
  it("renders nothing when nobody is typing", () => {
    expect(formatTyping([])).toBe("");
  });

  it("names a single typist", () => {
    expect(formatTyping(["Ana"])).toBe("Ana is typing…");
  });

  it("names both when exactly two distinct people type", () => {
    expect(formatTyping(["Ana", "Bo"])).toBe("Ana and Bo are typing…");
  });

  it("counts instead of naming beyond two", () => {
    expect(formatTyping(["Ana", "Bo", "Cy"])).toBe("3 people are typing…");
  });

  // Two peers who have not set a display name both render as the anonymous
  // label; naming them would read "Someone and Someone".
  it("collapses to a count when two names are identical", () => {
    expect(formatTyping(["Someone", "Someone"])).toBe("2 people are typing…");
  });
});
