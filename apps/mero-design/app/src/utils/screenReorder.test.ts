import { describe, expect, it } from "vitest";
import { dropSlotAt, moveTarget } from "./screenReorder";

const rows = [
  { top: 0, height: 40 },
  { top: 40, height: 40 },
  { top: 80, height: 40 },
  { top: 120, height: 40 },
];

describe("dropSlotAt", () => {
  it("the top half of a row is before it, the bottom half after", () => {
    expect(dropSlotAt(rows, 45)).toEqual({ index: 1, edge: "before" });
    expect(dropSlotAt(rows, 75)).toEqual({ index: 1, edge: "after" });
  });
  it("above the list is before the first row", () => {
    expect(dropSlotAt(rows, -30)).toEqual({ index: 0, edge: "before" });
  });
  it("below the list is after the last row", () => {
    expect(dropSlotAt(rows, 900)).toEqual({ index: 3, edge: "after" });
  });
  it("an empty list has nowhere to drop", () => {
    expect(dropSlotAt([], 10)).toBeNull();
  });
});

describe("moveTarget", () => {
  it("dragging 4 above 2 lands at index 1", () => {
    expect(moveTarget(3, { index: 1, edge: "before" })).toBe(1);
  });
  it("dragging 1 below 3 lands at index 2 (the removal shifts later slots)", () => {
    expect(moveTarget(0, { index: 2, edge: "after" })).toBe(2);
  });
  it("dropping a row against its own edges is not a move", () => {
    expect(moveTarget(2, { index: 2, edge: "before" })).toBeNull();
    expect(moveTarget(2, { index: 2, edge: "after" })).toBeNull();
    expect(moveTarget(2, { index: 1, edge: "after" })).toBeNull();
    expect(moveTarget(2, { index: 3, edge: "before" })).toBeNull();
  });
  it("to the very end and the very start", () => {
    expect(moveTarget(0, { index: 3, edge: "after" })).toBe(3);
    expect(moveTarget(3, { index: 0, edge: "before" })).toBe(0);
  });
});
