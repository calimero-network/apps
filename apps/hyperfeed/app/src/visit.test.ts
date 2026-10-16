import { beforeEach, describe, expect, it } from "vitest";
import { touchVisit, VISIT_GAP_MS } from "./visit";

describe("touchVisit", () => {
  beforeEach(() => localStorage.clear());

  it("has no previous visit the first time", () => {
    expect(touchVisit("f", 1_000)).toBe(0);
  });

  it("keeps the same start while you stay, and moves it when you come back", () => {
    touchVisit("f", 1_000);
    expect(touchVisit("f", 1_000 + 60_000)).toBe(0);
    const left = 1_000 + 60_000;
    expect(touchVisit("f", left + VISIT_GAP_MS + 1)).toBe(left);
    // Reloading during the new visit keeps it.
    expect(touchVisit("f", left + VISIT_GAP_MS + 5_000)).toBe(left);
  });

  it("keeps each feed apart", () => {
    touchVisit("a", 1_000);
    expect(touchVisit("b", 1_000 + VISIT_GAP_MS * 2)).toBe(0);
  });
});
